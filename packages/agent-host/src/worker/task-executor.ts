import { cwd } from 'node:process';
import type {
	AgentEvent,
	ICallerIdentity,
	IProviderAdapter,
} from '@agent-group-lab/contracts/agent';
import {
	AGENT_EVENT,
	type AgentRole,
	COMMITMENT_ACTION,
	type IAgentEventPayload,
	type ICommitmentActionPayload,
	type ITaskAssignPayload,
	type ITaskFailedPayload,
	TASK_FAILED,
} from '@agent-group-lab/contracts/messages';
import type { IProtocolEnvelope } from '@agent-group-lab/protocol';
import type { IWorkerClientPort } from '~/ports/worker-client-port';
import { annotateToolStartEvent } from './agent-event-annotator';
import type { PromptComposer } from './prompt-composer';
import type { ITurnContext } from './turn-context';

interface ITaskExecutorOptions {
	clientPort: IWorkerClientPort;
	adapter: IProviderAdapter;
	agentId: string;
	agentName: string;
	createEnvelope: (
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => IProtocolEnvelope<string, unknown>;
	createTurnContext: () => Promise<ITurnContext>;
	promptComposer: PromptComposer;
	workerRole: AgentRole;
	log: (message: string) => void;
	onEvent?: (payload: IAgentEventPayload) => void;
}

export class TaskExecutor {
	private readonly options: ITaskExecutorOptions;
	private activeTaskId: string | null = null;

	constructor(options: ITaskExecutorOptions) {
		this.options = options;
	}

	getActiveTaskId = () => {
		return this.activeTaskId;
	};

	cancelDirectRequest = () => {
		this.options.adapter.abort?.();
	};

	executeAssignedTask = async (task: ITaskAssignPayload) => {
		if (this.activeTaskId) {
			const busyPayload: ITaskFailedPayload = {
				taskId: task.taskId,
				agentId: this.options.agentId,
				agentName: this.options.agentName,
				message: `Worker is busy with task ${this.activeTaskId}`,
			};
			await this.options.clientPort.send(
				this.options.createEnvelope({
					type: TASK_FAILED,
					channel: `task:${task.taskId}`,
					trace: {
						taskId: task.taskId,
						turnId: task.turnId,
					},
					payload: busyPayload,
				}),
			);
			return;
		}

		this.activeTaskId = task.taskId;
		this.options.log(`Running task ${task.taskId}`);
		let acceptSent = false;
		try {
			const acceptPayload: ICommitmentActionPayload = {
				action: 'ACCEPT',
				taskId: task.taskId,
			};
			await this.options.clientPort.send(
				this.options.createEnvelope({
					type: COMMITMENT_ACTION,
					channel: `task:${task.taskId}`,
					trace: {
						taskId: task.taskId,
						turnId: task.turnId,
					},
					payload: acceptPayload,
				}),
			);
			acceptSent = true;

			const content = await this.runTurnAndCollectText({
				task,
				channel: `task:${task.taskId}`,
				trace: {
					taskId: task.taskId,
					turnId: task.turnId,
				},
				callerIdentity: { kind: 'system' },
			});

			const deliverPayload: ICommitmentActionPayload = {
				action: 'DELIVER',
				taskId: task.taskId,
				artifact: {
					content,
				},
			};
			await this.options.clientPort.send(
				this.options.createEnvelope({
					type: COMMITMENT_ACTION,
					channel: `task:${task.taskId}`,
					trace: {
						taskId: task.taskId,
						turnId: task.turnId,
					},
					payload: deliverPayload,
				}),
			);
			this.options.log(`Task completed: ${task.taskId}`);
		} catch (error) {
			const messageText =
				error instanceof Error ? error.message : 'Unknown task execution error';
			if (!acceptSent) {
				const failedPayload: ITaskFailedPayload = {
					taskId: task.taskId,
					agentId: this.options.agentId,
					agentName: this.options.agentName,
					message: messageText,
				};
				await this.options.clientPort.send(
					this.options.createEnvelope({
						type: TASK_FAILED,
						channel: `task:${task.taskId}`,
						trace: {
							taskId: task.taskId,
							turnId: task.turnId,
						},
						payload: failedPayload,
					}),
				);
				return;
			}

			const failedPayload: ICommitmentActionPayload = {
				action: 'FAIL',
				taskId: task.taskId,
				reason: messageText,
			};
			await this.options.clientPort.send(
				this.options.createEnvelope({
					type: COMMITMENT_ACTION,
					channel: `task:${task.taskId}`,
					trace: {
						taskId: task.taskId,
						turnId: task.turnId,
					},
					payload: failedPayload,
				}),
			);
		} finally {
			this.activeTaskId = null;
		}
	};

	executeDirectRequest = async (input: {
		requestId: string;
		prompt: string;
		workingDirectory?: string;
		onLocalEvent?: (event: AgentEvent) => void;
		caller: ICallerIdentity;
	}) => {
		if (this.activeTaskId) {
			return {
				status: 'busy' as const,
				activeTaskId: this.activeTaskId,
			};
		}

		this.activeTaskId = `direct:${input.requestId}`;
		try {
			const content = await this.runTurnAndCollectText({
				task: {
					taskId: `direct:${input.requestId}`,
					turnId: input.requestId,
					prompt: input.prompt,
					workingDirectory: input.workingDirectory || cwd(),
					agentName: this.options.agentName,
				},
				channel: `direct:${input.requestId}`,
				onLocalEvent: input.onLocalEvent,
				callerIdentity: input.caller,
			});
			return {
				status: 'delivered' as const,
				content: content || undefined,
			};
		} catch (error) {
			return {
				status: 'failed' as const,
				reason:
					error instanceof Error
						? error.message
						: 'Unknown direct request error',
			};
		} finally {
			this.activeTaskId = null;
		}
	};

	private runTurnAndCollectText = async (input: {
		task: ITaskAssignPayload;
		channel: IProtocolEnvelope['channel'];
		trace?: {
			taskId: string;
			turnId: string;
		};
		onLocalEvent?: (event: AgentEvent) => void;
		callerIdentity: ICallerIdentity;
	}) => {
		const textParts: string[] = [];
		const turnContext = await this.options.createTurnContext();
		await this.runTaskWithAdapter({
			adapter: this.options.adapter,
			task: input.task,
			turnContext,
			callerIdentity: input.callerIdentity,
			onEvent: async (event) => {
				const annotatedEvent = annotateToolStartEvent(event);
				if (event.type === 'text:done') {
					textParts.push(event.content);
				}
				const payload: IAgentEventPayload = {
					taskId: input.task.taskId,
					agentId: this.options.agentId,
					agentName: this.options.agentName,
					event: annotatedEvent,
				};
				input.onLocalEvent?.(event);
				this.options.onEvent?.(payload);
				await this.options.clientPort.send(
					this.options.createEnvelope({
						type: AGENT_EVENT,
						channel: input.channel,
						...(input.trace ? { trace: input.trace } : {}),
						payload,
					}),
				);
			},
		});

		return textParts.join('');
	};

	private runTaskWithAdapter = async (options: {
		adapter: IProviderAdapter;
		task: ITaskAssignPayload;
		turnContext: ITurnContext;
		callerIdentity: ICallerIdentity;
		onEvent: (event: AgentEvent) => Promise<void> | void;
	}) => {
		const composed = this.options.promptComposer.compose({
			task: options.task,
			workerRole: this.options.workerRole,
			selfIdentity: {
				agentId: this.options.agentId,
				agentName: this.options.agentName,
			},
			callerIdentity: options.callerIdentity,
		});
		for await (const event of options.adapter.runTurn({
			taskId: options.task.taskId,
			turnId: options.task.turnId,
			prompt: composed.prompt,
			workingDirectory: options.task.workingDirectory,
			tools: options.turnContext.tools,
			systemPromptSuffix:
				composed.systemPromptSuffix.length > 0
					? composed.systemPromptSuffix
					: undefined,
		})) {
			await options.onEvent(event);
		}
	};
}
