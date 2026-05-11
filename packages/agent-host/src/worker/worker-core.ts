import type {
	AgentEvent,
	IProviderAdapter,
} from '@agent-group-lab/contracts/agent';
import {
	type AgentRole,
	DIRECT_CANCEL,
	DIRECT_REQUEST,
	DIRECT_RESPONSE,
	type IAgentEventPayload,
	type ITaskAssignPayload,
	type ITaskChildDeliveredPayload,
	type ITaskChildrenCompletedPayload,
	type ITaskClaimResultPayload,
	type ITaskFailedPayload,
	type ITaskListResultPayload,
	type ITaskPlanNodePayload,
	type ITaskPublishBatchResultPayload,
	type IWorkerProfile,
	type IWorkerRegisterPayload,
	parseTaskAssignPayload,
	parseTaskChildrenStatusResultPayload,
	parseTaskClaimResultPayload,
	parseTaskListResultPayload,
	parseTaskPublishBatchResultPayload,
	TASK_ACCEPTED,
	TASK_ASSIGN,
	TASK_CHILD_DELIVERED,
	TASK_CHILDREN_COMPLETED,
	TASK_CHILDREN_STATUS_RESULT,
	TASK_CLAIM_RESULT,
	TASK_COMPLETED,
	TASK_FAILED,
	TASK_LIST,
	TASK_LIST_RESULT,
	TASK_PUBLISH_BATCH,
	TASK_PUBLISH_BATCH_RESULT,
	WORKER_REGISTER,
} from '@agent-group-lab/contracts/messages';
import {
	controlDisconnectPayloadSchema,
	createEnvelope,
	type IProtocolEnvelope,
	type IProtocolErrorPayload,
	PROTOCOL_VERSION,
	protocolErrorPayloadSchema,
} from '@agent-group-lab/protocol';
import { nanoid } from 'nanoid';
import type { IWorkerClientPort } from '~/ports/worker-client-port';
import { ClaimLoop } from './claim-loop';
import {
	DelegationManager,
	type IDelegateTaskInput,
} from './delegation-manager';
import { DirectPeer, type ISendDirectRequestAndWaitInput } from './direct-peer';
import { PeerDirectory } from './peer-directory';
import { PromptComposer } from './prompt-composer';
import { ReconnectLoop } from './reconnect-loop';
import { TaskExecutor } from './task-executor';
import {
	buildAskPeerTool,
	buildDelegateTaskTool,
	buildGetPeersTool,
	buildGetTasksByIdsTool,
	buildPublishClaimableTasksTool,
	buildWaitForChildrenTool,
} from './tool-builder';
import type { ITurnContext } from './turn-context';
import { WaitManager } from './wait-manager';

export type IWorkerLifecycleEvent =
	| { type: 'disconnected' }
	| { type: 'reconnect_attempt'; attempt: number; maxAttempts: number }
	| { type: 'reconnected' }
	| { type: 'rejected'; reason: string }
	| { type: 'gave_up' };

export interface IWorkerCoreOptions {
	agentId?: string;
	agentName?: string;
	workerRole?: AgentRole;
	onEvent?: (payload: IAgentEventPayload) => void;
	workerProfile?: IWorkerProfile;
	onLog?: (message: string) => void;
	heartbeatMs?: number;
	reconnectBaseDelayMs?: number;
	reconnectMaxDelayMs?: number;
	maxReconnectAttempts?: number;
	appVersion?: string;
	directDefaultTimeoutMs?: number;
	directDefaultTtlMs?: number;
	directMaxHops?: number;
	directMaxPendingOutbound?: number;
	delegateDefaultTimeoutMs?: number;
	delegateMaxPendingOutbound?: number;
	peerDirectoryCacheTtlMs?: number;
	peerDirectoryFetchTimeoutMs?: number;
	enableTaskClaim?: boolean;
	claimLeaseMs?: number;
	claimBackoffBaseMs?: number;
	claimBackoffMaxMs?: number;
	claimAwaitAssignTimeoutMs?: number;
}

export class WorkerCore {
	private readonly workerHandlerMap: ReadonlyMap<
		string,
		(message: IProtocolEnvelope) => Promise<void>
	>;
	private readonly options: IWorkerCoreOptions;
	private readonly clientPort: IWorkerClientPort;
	private readonly adapter: IProviderAdapter;
	private readonly agentId: string;
	private readonly agentName: string;
	private readonly workerRole: AgentRole;
	private readonly heartbeatMs: number;
	private readonly reconnectLoop: ReconnectLoop;
	private readonly appVersion: string;
	private readonly delegationManager: DelegationManager;
	private readonly directPeer: DirectPeer;
	private readonly peerDirectory: PeerDirectory;
	private readonly promptComposer: PromptComposer;
	private readonly taskExecutor: TaskExecutor;
	private readonly claimLoop?: ClaimLoop;
	private readonly waitManager: WaitManager;
	private readonly pendingPublishBatch = new Map<
		string,
		{
			resolve: (payload: ITaskPublishBatchResultPayload) => void;
			reject: (error: Error) => void;
		}
	>();
	private readonly pendingTaskListQuery = new Map<
		string,
		{
			resolve: (payload: ITaskListResultPayload) => void;
			reject: (error: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	private readonly pendingAssignmentTimeouts = new Map<
		string,
		ReturnType<typeof setTimeout>
	>();
	private readonly claimAwaitAssignTimeoutMs: number;
	private readonly expectedAssignmentTokens = new Map<string, string>();
	private readonly lifecycleListeners = new Set<
		(event: IWorkerLifecycleEvent) => void
	>();
	private sessionEpoch = 0;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private nextSeq = 1;
	private isClosing = false;
	private unsubscribeDisconnect?: () => void;

	constructor(
		options: IWorkerCoreOptions,
		adapter: IProviderAdapter,
		clientPort: IWorkerClientPort,
	) {
		this.options = options;
		this.adapter = adapter;
		this.clientPort = clientPort;
		this.agentId = options.agentId ?? `agent_${nanoid(8)}`;
		this.agentName = options.agentName ?? this.agentId;
		this.workerRole = options.workerRole ?? 'executor';
		this.heartbeatMs = options.heartbeatMs ?? 10_000;
		this.appVersion = options.appVersion ?? '0b-local-worker';
		const directDefaultTimeoutMs = options.directDefaultTimeoutMs ?? 60_000;
		const directDefaultTtlMs = options.directDefaultTtlMs ?? 60_000;
		const directMaxHops = options.directMaxHops ?? 3;
		const directMaxPendingOutbound = options.directMaxPendingOutbound ?? 4;
		const delegateDefaultTimeoutMs =
			options.delegateDefaultTimeoutMs ?? 180_000;
		this.delegationManager = new DelegationManager({
			clientPort: this.clientPort,
			createEnvelope: this.createEnvelope,
			agentId: this.agentId,
			workerRole: this.workerRole,
			delegateDefaultTimeoutMs,
			delegateMaxPendingOutbound: options.delegateMaxPendingOutbound ?? 8,
			resolveCurrentSourceTaskId: this.resolveCurrentSourceTaskId,
		});
		this.peerDirectory = new PeerDirectory({
			clientPort: this.clientPort,
			createEnvelope: this.createEnvelope,
			agentId: this.agentId,
			peerDirectoryCacheTtlMs: options.peerDirectoryCacheTtlMs ?? 10_000,
			peerDirectoryFetchTimeoutMs: options.peerDirectoryFetchTimeoutMs ?? 500,
			log: this.log,
		});
		this.promptComposer = new PromptComposer({ log: this.log });
		this.taskExecutor = new TaskExecutor({
			clientPort: this.clientPort,
			adapter: this.adapter,
			agentId: this.agentId,
			agentName: this.agentName,
			createEnvelope: this.createEnvelope,
			createTurnContext: this.createTurnContext,
			workerRole: this.workerRole,
			promptComposer: this.promptComposer,
			log: this.log,
			onEvent: options.onEvent,
		});
		this.directPeer = new DirectPeer({
			clientPort: this.clientPort,
			agentId: this.agentId,
			agentName: this.agentName,
			createEnvelope: this.createEnvelope,
			log: this.log,
			getActiveTaskId: this.taskExecutor.getActiveTaskId,
			executeDirectRequest: this.taskExecutor.executeDirectRequest,
			resolveCurrentSourceTaskId: this.resolveCurrentSourceTaskId,
			directDefaultTimeoutMs,
			directDefaultTtlMs,
			directMaxHops,
			directMaxPendingOutbound,
		});
		this.waitManager = new WaitManager({
			clientPort: this.clientPort,
			createEnvelope: this.createEnvelope,
			log: this.log,
		});
		this.claimAwaitAssignTimeoutMs = options.claimAwaitAssignTimeoutMs ?? 5_000;
		if (this.workerRole === 'executor' && options.enableTaskClaim === true) {
			this.claimLoop = new ClaimLoop({
				clientPort: this.clientPort,
				createEnvelope: this.createEnvelope,
				agentId: this.agentId,
				claimLeaseMs: options.claimLeaseMs ?? 30_000,
				claimBackoffBaseMs: options.claimBackoffBaseMs ?? 500,
				claimBackoffMaxMs: options.claimBackoffMaxMs ?? 5_000,
				log: this.log,
				canRequestClaim: () => this.taskExecutor.getActiveTaskId() === null,
			});
		}
		const maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
		this.reconnectLoop = new ReconnectLoop({
			reconnectBaseDelayMs: options.reconnectBaseDelayMs ?? 1_000,
			reconnectMaxDelayMs: options.reconnectMaxDelayMs ?? 10_000,
			maxReconnectAttempts,
			isClosing: () => this.isClosing,
			log: this.log,
			reconnectOnce: async () => {
				await this.clientPort.close();
				await this.connectAndRegister();
			},
			onAttempt: (attempt) => {
				this.emitLifecycleEvent({
					type: 'reconnect_attempt',
					attempt,
					maxAttempts: maxReconnectAttempts,
				});
			},
			onGiveUp: () => {
				this.emitLifecycleEvent({ type: 'gave_up' });
			},
		});
		this.workerHandlerMap = this.createWorkerHandlerMap();
	}

	onLifecycleEvent = (
		listener: (event: IWorkerLifecycleEvent) => void,
	): (() => void) => {
		this.lifecycleListeners.add(listener);
		return () => {
			this.lifecycleListeners.delete(listener);
		};
	};

	sendDirectRequestAndWait = async (input: ISendDirectRequestAndWaitInput) => {
		return await this.directPeer.sendDirectRequestAndWait(input);
	};

	runLocal = (input: {
		prompt: string;
		workingDirectory?: string;
		onEvent?: (event: AgentEvent) => void;
	}) => {
		return this.taskExecutor.executeDirectRequest({
			requestId: nanoid(),
			prompt: input.prompt,
			workingDirectory: input.workingDirectory,
			onLocalEvent: input.onEvent,
			caller: { kind: 'local-user' },
		});
	};

	cancelRunLocal = () => {
		this.taskExecutor.cancelDirectRequest();
	};

	start = async () => {
		this.clientPort.subscribe((message) => {
			this.handleMessage(message).catch((error) => {
				this.log(
					`[error] ${error instanceof Error ? error.message : String(error)}`,
				);
			});
		});
		this.unsubscribeDisconnect = this.clientPort.onDisconnect(() => {
			this.handleDisconnected('socket closed');
		});

		await this.connectAndRegister();
		this.claimLoop?.start();

		this.heartbeatTimer = setInterval(() => {
			this.sendHeartbeat().catch((error) => {
				this.log(
					`[error] heartbeat failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				this.reconnectLoop.scheduleReconnect('heartbeat failed');
			});
		}, this.heartbeatMs);
	};

	close = async () => {
		this.isClosing = true;

		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
		this.reconnectLoop.dispose();
		if (this.unsubscribeDisconnect) {
			this.unsubscribeDisconnect();
			this.unsubscribeDisconnect = undefined;
		}
		this.directPeer.rejectAllPending(new Error('Worker is closing'));
		this.delegationManager.rejectAllPending(new Error('Worker is closing'));
		this.waitManager.rejectAll(new Error('Worker is closing'));
		this.claimLoop?.stop();
		for (const timer of this.pendingAssignmentTimeouts.values()) {
			clearTimeout(timer);
		}
		this.pendingAssignmentTimeouts.clear();
		this.expectedAssignmentTokens.clear();
		for (const pending of this.pendingPublishBatch.values()) {
			pending.reject(new Error('Worker is closing'));
		}
		this.pendingPublishBatch.clear();
		for (const pending of this.pendingTaskListQuery.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error('Worker is closing'));
		}
		this.pendingTaskListQuery.clear();
		await this.clientPort.close();
	};

	private handleMessage = async (message: IProtocolEnvelope) => {
		const handler = this.workerHandlerMap.get(message.type);
		if (!handler) {
			return;
		}
		await handler(message);
	};

	private createWorkerHandlerMap = () => {
		return new Map<string, (message: IProtocolEnvelope) => Promise<void>>([
			['control:ack', async () => {}],
			['control:ready', async () => {}],
			[
				'control:error',
				async (message) => {
					this.handleControlError(message);
				},
			],
			[
				'control:disconnect',
				async (message) => {
					this.handleControlDisconnect(message);
				},
			],
			[
				TASK_ACCEPTED,
				async (message) => {
					this.delegationManager.handleTaskAccepted(message);
				},
			],
			[
				TASK_COMPLETED,
				async (message) => {
					this.delegationManager.handleTaskCompleted(message);
				},
			],
			[
				TASK_FAILED,
				async (message) => {
					this.delegationManager.handleTaskFailed(message);
					const failed = message.payload as {
						taskId?: string;
						message?: string;
					};
					if (
						typeof failed.taskId === 'string' &&
						typeof failed.message === 'string'
					) {
						await this.waitManager.handleTaskFailed({
							taskId: failed.taskId,
							agentId: this.agentId,
							agentName: this.agentName,
							message: failed.message,
						});
					}
				},
			],
			[
				TASK_CHILD_DELIVERED,
				async (message) => {
					this.delegationManager.handleTaskChildDelivered(message);
					const payload =
						message.payload as Partial<ITaskChildDeliveredPayload>;
					if (
						typeof payload.parentTaskId === 'string' &&
						typeof payload.childTaskId === 'string' &&
						typeof payload.childAssigneeId === 'string' &&
						typeof payload.remainingChildren === 'number' &&
						typeof payload.allChildrenDone === 'boolean'
					) {
						await this.waitManager.handleChildDelivered(
							payload as ITaskChildDeliveredPayload,
						);
					}
				},
			],
			[
				DIRECT_RESPONSE,
				async (message) => {
					await this.directPeer.handleDirectResponse(message);
				},
			],
			[
				DIRECT_CANCEL,
				async (message) => {
					await this.directPeer.handleDirectCancel(message);
				},
			],
			[
				DIRECT_REQUEST,
				async (message) => {
					await this.directPeer.handleDirectRequest(message);
				},
			],
			[
				TASK_ASSIGN,
				async (message) => {
					const task = parseTaskAssignPayload(message.payload);
					if (!task) {
						await this.clientPort.send(
							this.createEnvelope({
								type: 'control:error',
								channel: 'control',
								payload: {
									code: 'protocol',
									message: 'Invalid task:assign payload',
								} satisfies IProtocolErrorPayload,
							}),
						);
						return;
					}
					await this.handleTaskAssign(task);
				},
			],
			[
				TASK_CLAIM_RESULT,
				async (message) => {
					const parsed = parseTaskClaimResultPayload(message.payload);
					if (!parsed) {
						return;
					}
					this.handleTaskClaimResult(parsed);
				},
			],
			[
				TASK_PUBLISH_BATCH_RESULT,
				async (message) => {
					const parsed = parseTaskPublishBatchResultPayload(message.payload);
					if (!parsed) {
						return;
					}
					const pending = this.pendingPublishBatch.get(parsed.planId);
					if (!pending) {
						return;
					}
					this.pendingPublishBatch.delete(parsed.planId);
					pending.resolve(parsed);
				},
			],
			[
				TASK_CHILDREN_COMPLETED,
				async (message) => {
					const payload =
						message.payload as Partial<ITaskChildrenCompletedPayload>;
					if (typeof payload.parentTaskId !== 'string') {
						return;
					}
					await this.waitManager.handleChildrenCompleted({
						parentTaskId: payload.parentTaskId,
						parentAssigneeId: payload.parentAssigneeId ?? this.agentId,
						parentAssigneeName:
							payload.parentAssigneeName ??
							payload.parentAssigneeId ??
							this.agentId,
						childTaskIds: Array.isArray(payload.childTaskIds)
							? payload.childTaskIds
							: [],
					});
				},
			],
			[
				TASK_CHILDREN_STATUS_RESULT,
				async (message) => {
					const parsed = parseTaskChildrenStatusResultPayload(message.payload);
					if (!parsed) {
						return;
					}
					await this.waitManager.handleChildrenStatusResult(parsed);
				},
			],
			[
				TASK_LIST_RESULT,
				async (message) => {
					const parsed = parseTaskListResultPayload(message.payload);
					if (!parsed) {
						return;
					}
					const pending = this.pendingTaskListQuery.get(parsed.requestId);
					if (!pending) {
						return;
					}
					clearTimeout(pending.timer);
					this.pendingTaskListQuery.delete(parsed.requestId);
					pending.resolve(parsed);
				},
			],
		]);
	};

	private handleControlError = (message: IProtocolEnvelope) => {
		const parsed = protocolErrorPayloadSchema.safeParse(message.payload);
		if (!parsed.success) {
			return;
		}
		const payload = parsed.data;
		this.delegationManager.tryResolveByControlError(payload);
		this.log(`[error] host: ${payload.message}`);
	};

	private handleControlDisconnect = (message: IProtocolEnvelope) => {
		const parsed = controlDisconnectPayloadSchema.safeParse(message.payload);
		if (!parsed.success) {
			return;
		}
		const { reason, message: msg, retryable } = parsed.data;
		this.log(
			`[disconnect] host: ${msg} (reason=${reason}, retryable=${retryable})`,
		);
		if (!retryable) {
			this.isClosing = true;
			this.emitLifecycleEvent({ type: 'rejected', reason });
		}
	};

	private handleTaskAssign = async (task: ITaskAssignPayload) => {
		const expectedToken = this.expectedAssignmentTokens.get(task.taskId);
		if (expectedToken) {
			if (!task.assignmentToken || task.assignmentToken !== expectedToken) {
				const mismatchPayload: ITaskFailedPayload = {
					taskId: task.taskId,
					agentId: this.agentId,
					agentName: this.agentName,
					message: 'assignmentToken mismatch',
				};
				await this.clientPort.send(
					this.createEnvelope({
						type: TASK_FAILED,
						channel: `task:${task.taskId}`,
						payload: mismatchPayload,
					}),
				);
				return;
			}
			const pendingTimeout = this.pendingAssignmentTimeouts.get(task.taskId);
			if (pendingTimeout) {
				clearTimeout(pendingTimeout);
				this.pendingAssignmentTimeouts.delete(task.taskId);
			}
			this.expectedAssignmentTokens.delete(task.taskId);
		}
		this.claimLoop?.triggerSoon();
		await this.taskExecutor.executeAssignedTask(task);
	};

	private handleTaskClaimResult = (parsed: ITaskClaimResultPayload) => {
		if (
			parsed.status === 'claimed' &&
			typeof parsed.taskId === 'string' &&
			typeof parsed.assignmentToken === 'string'
		) {
			const claimedTaskId = parsed.taskId;
			const claimedAssignmentToken = parsed.assignmentToken;
			this.expectedAssignmentTokens.set(claimedTaskId, claimedAssignmentToken);
			const existingTimeout = this.pendingAssignmentTimeouts.get(claimedTaskId);
			if (existingTimeout) {
				clearTimeout(existingTimeout);
			}
			const timeout = setTimeout(() => {
				const currentToken = this.expectedAssignmentTokens.get(claimedTaskId);
				if (currentToken !== claimedAssignmentToken) {
					return;
				}
				this.expectedAssignmentTokens.delete(claimedTaskId);
				this.pendingAssignmentTimeouts.delete(claimedTaskId);
				this.log(
					`[claim-loop] awaiting_assign_timeout taskId=${claimedTaskId}`,
				);
				this.claimLoop?.triggerSoon();
			}, this.claimAwaitAssignTimeoutMs);
			this.pendingAssignmentTimeouts.set(claimedTaskId, timeout);
		}
		this.claimLoop?.onClaimResult(parsed);
	};

	private resolveCurrentSourceTaskId = () => {
		const activeTaskId = this.taskExecutor.getActiveTaskId();
		if (!activeTaskId) {
			return undefined;
		}
		if (activeTaskId.startsWith('direct:')) {
			return undefined;
		}
		return activeTaskId;
	};

	private createTurnContext = async (): Promise<ITurnContext> => {
		const tools = [
			buildAskPeerTool({
				sendDirectRequestAndWait: this.sendDirectRequestAndWait,
			}),
		];
		tools.push(
			buildGetPeersTool({
				getPeers: async () => {
					return await this.peerDirectory.fetchPeers();
				},
			}),
		);
		tools.push(
			buildDelegateTaskTool({
				sendDelegatedTaskAndWait: (input: IDelegateTaskInput) =>
					this.delegationManager.delegateTaskAndWait(input),
			}),
		);
		tools.push(
			buildPublishClaimableTasksTool({
				publishBatchAndWait: async (input) => {
					return await this.publishBatchAndWait(input);
				},
				resolveCurrentTaskId: this.resolveCurrentSourceTaskId,
			}),
		);
		tools.push(
			buildWaitForChildrenTool({
				waitForChildrenAndWait: async (input) => {
					return await this.waitManager.startWaitForChildren(input);
				},
				resolveCurrentTaskId: this.resolveCurrentSourceTaskId,
			}),
		);
		tools.push(
			buildGetTasksByIdsTool({
				getTaskStatusAndWait: async (input) => {
					return await this.getTaskStatusAndWait(input);
				},
			}),
		);
		return {
			tools,
		};
	};

	private createEnvelope = (
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => {
		return createEnvelope({
			seq: this.nextSeq++,
			...message,
		});
	};

	private connectAndRegister = async () => {
		await this.clientPort.connect();
		await this.clientPort.send(
			this.createEnvelope({
				type: 'control:hello',
				channel: 'control',
				payload: {
					protoVersion: PROTOCOL_VERSION,
					appVersion: this.appVersion,
				},
			}),
		);
		await this.clientPort.waitForMessage(
			(message) => message.type === 'control:ready',
		);

		const capabilities = await this.adapter.capabilities();
		const registerPayload: IWorkerRegisterPayload = {
			agentId: this.agentId,
			agentName: this.agentName,
			workerType: 'persistent',
			adapterId: this.adapter.id,
			capabilities,
			role: this.workerRole,
			workerProfile: this.options.workerProfile,
		};
		await this.clientPort.send(
			this.createEnvelope({
				type: WORKER_REGISTER,
				channel: 'control',
				payload: registerPayload,
			}),
		);
		this.log(
			`Worker connected as ${this.agentId} (${this.adapter.id}, role=${this.workerRole})`,
		);
		const isReconnect = this.sessionEpoch > 0;
		this.sessionEpoch += 1;
		this.waitManager.onReconnect(this.sessionEpoch);
		this.claimLoop?.triggerSoon();
		if (isReconnect) {
			this.emitLifecycleEvent({ type: 'reconnected' });
		}
	};

	private sendHeartbeat = async () => {
		if (this.isClosing || this.reconnectLoop.isReconnecting()) {
			return;
		}

		await this.clientPort.send(
			this.createEnvelope({
				type: 'control:heartbeat',
				channel: 'control',
				payload: {
					nonce: nanoid(),
				},
			}),
		);
	};

	private emitLifecycleEvent = (event: IWorkerLifecycleEvent) => {
		for (const listener of this.lifecycleListeners) {
			listener(event);
		}
	};

	private handleDisconnected = (reason: string) => {
		this.waitManager.onDisconnect();
		if (!this.isClosing) {
			this.emitLifecycleEvent({ type: 'disconnected' });
		}
		this.reconnectLoop.handleDisconnected(reason);
	};

	private publishBatchAndWait = async (input: {
		planId?: string;
		nodes: ITaskPlanNodePayload[];
		atomic?: boolean;
	}) => {
		const planId = input.planId ?? nanoid();
		const result = new Promise<ITaskPublishBatchResultPayload>(
			(resolve, reject) => {
				this.pendingPublishBatch.set(planId, { resolve, reject });
			},
		);
		await this.clientPort.send(
			this.createEnvelope({
				type: TASK_PUBLISH_BATCH,
				channel: `task:${planId}`,
				payload: {
					planId,
					nodes: input.nodes,
					atomic: input.atomic,
				},
			}),
		);
		return await result;
	};

	private getTaskStatusAndWait = async (input: {
		taskIds: string[];
		includeArtifacts: boolean;
	}) => {
		const requestId = nanoid();
		const result = new Promise<ITaskListResultPayload>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingTaskListQuery.delete(requestId);
				reject(new Error('task:list request timed out'));
			}, 10_000);
			this.pendingTaskListQuery.set(requestId, { resolve, reject, timer });
		});
		await this.clientPort.send(
			this.createEnvelope({
				type: TASK_LIST,
				channel: `task:${requestId}`,
				payload: {
					requestId,
					taskIds: input.taskIds,
					includeArtifacts: input.includeArtifacts,
				},
			}),
		);
		return await result;
	};

	private log = (message: string) => {
		this.options.onLog?.(message);
	};
}
