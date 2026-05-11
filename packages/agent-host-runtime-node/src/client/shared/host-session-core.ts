import type { IAgentEventEnvelope } from '@agent-group-lab/contracts/agent';
import type {
	IDirectRequestPayload,
	IDirectResponsePayload,
	ITaskAcceptedPayload,
	ITaskChildrenStatusResultPayload,
	ITaskPlanNodePayload,
	ITaskPublishBatchResultPayload,
} from '@agent-group-lab/contracts/messages';
import {
	parseAgentEventPayload,
	parseDirectResponsePayload,
	parseTaskAcceptedPayload,
	parseTaskChildrenStatusResultPayload,
	parseTaskCompletedPayload,
	parseTaskFailedPayload,
	parseTaskPublishBatchResultPayload,
	parseWorkersListResultPayload,
} from '@agent-group-lab/contracts/messages';
import {
	createEnvelope,
	type IProtocolEnvelope,
	type IProtocolErrorPayload,
	PROTOCOL_VERSION,
} from '@agent-group-lab/protocol';
import { nanoid } from 'nanoid';
import type { IClientPort } from '~/ports/client-port';

export interface IAssignTaskInput {
	prompt: string;
	workingDirectory?: string;
	agentId?: string;
	onAgentEvent?: (payload: IAgentEventEnvelope) => void;
	onTaskAccepted?: (payload: ITaskAcceptedPayload) => void;
	timeoutMs?: number;
}

export interface IAssignTaskResult {
	taskId: string;
	turnId: string;
	agentId: string;
	agentName: string;
}

export interface IListWorkersInput {
	includeOffline?: boolean;
}

export type ISendDirectRequestInput = Omit<IDirectRequestPayload, 'requestId'>;

export interface IPublishBatchInput {
	planId?: string;
	nodes: ITaskPlanNodePayload[];
	atomic?: boolean;
	timeoutMs?: number;
}

export interface IGetChildrenStatusInput {
	parentTaskId: string;
	includeArtifacts?: boolean;
	timeoutMs?: number;
}

export interface IHostSession {
	assignTask(input: IAssignTaskInput): Promise<IAssignTaskResult>;
	listWorkers(
		input?: IListWorkersInput,
	): Promise<
		NonNullable<ReturnType<typeof parseWorkersListResultPayload>>['workers']
	>;
	sendDirectRequest(
		input: ISendDirectRequestInput,
	): Promise<IDirectResponsePayload>;
	publishBatch(
		input: IPublishBatchInput,
	): Promise<ITaskPublishBatchResultPayload>;
	getChildrenStatus(
		input: IGetChildrenStatusInput,
	): Promise<ITaskChildrenStatusResultPayload>;
	close(): Promise<void>;
}

export interface ICreateHostSessionOptions {
	appVersion?: string;
}

export const createHostSession = async (
	clientPort: IClientPort,
	options: ICreateHostSessionOptions = {},
): Promise<IHostSession> => {
	let seq = 1;
	const nextSeq = () => seq++;

	await clientPort.connect();
	await clientPort.send(
		createEnvelope({
			seq: nextSeq(),
			type: 'control:hello',
			channel: 'control',
			payload: {
				protoVersion: PROTOCOL_VERSION,
				appVersion: options.appVersion ?? '0b-local-client',
			},
		}),
	);
	await clientPort.waitForMessage(
		(message) => message.type === 'control:ready',
	);

	const send = async (
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => {
		await clientPort.send(createEnvelope({ seq: nextSeq(), ...message }));
	};

	const assignTask = async (
		input: IAssignTaskInput,
	): Promise<IAssignTaskResult> => {
		const taskId = nanoid();
		const turnId = nanoid();
		let assignedAgent: {
			agentId: string;
			agentName: string;
		} | null = null;
		let timeout: ReturnType<typeof setTimeout> | null = null;
		let unsub: (() => void) | null = null;

		const cleanup = () => {
			if (timeout) {
				clearTimeout(timeout);
				timeout = null;
			}
			if (unsub) {
				unsub();
				unsub = null;
			}
		};

		const result = new Promise<IAssignTaskResult>((resolve, reject) => {
			unsub = clientPort.subscribe((message) => {
				if (message.type === 'task:accepted') {
					const payload = parseTaskAcceptedPayload(message.payload);
					if (!payload || payload.taskId !== taskId) {
						return;
					}
					assignedAgent = {
						agentId: payload.agentId,
						agentName: payload.agentName,
					};
					input.onTaskAccepted?.(payload);
					return;
				}

				if (message.type === 'agent:event') {
					const payload = parseAgentEventPayload(message.payload);
					if (!payload || payload.taskId !== taskId) {
						return;
					}
					input.onAgentEvent?.(payload);
					return;
				}

				if (message.type === 'task:completed') {
					const payload = parseTaskCompletedPayload(message.payload);
					if (!payload || payload.taskId !== taskId) {
						return;
					}
					cleanup();
					resolve({
						taskId,
						turnId,
						agentId: assignedAgent?.agentId ?? payload.agentId,
						agentName: assignedAgent?.agentName ?? payload.agentName,
					});
					return;
				}

				if (message.type === 'task:failed') {
					const payload = parseTaskFailedPayload(message.payload);
					if (!payload || payload.taskId !== taskId) {
						return;
					}
					cleanup();
					reject(new Error(payload.message));
					return;
				}

				if (message.type === 'control:error') {
					const payload = message.payload as IProtocolErrorPayload;
					const trace = message.trace;
					if (trace?.taskId && trace.taskId !== taskId) {
						return;
					}
					cleanup();
					reject(new Error(payload.message));
				}
			});

			const timeoutMs = input.timeoutMs ?? 10 * 60_000;
			timeout = setTimeout(() => {
				cleanup();
				reject(new Error('Task timed out'));
			}, timeoutMs);
		});

		await send({
			type: 'task:assign',
			channel: `task:${taskId}`,
			trace: { taskId, turnId },
			payload: {
				taskId,
				turnId,
				prompt: input.prompt,
				workingDirectory: input.workingDirectory,
				agentId: input.agentId,
			},
		});

		return await result;
	};

	const listWorkers = async (input: IListWorkersInput = {}) => {
		await send({
			type: 'workers:list',
			channel: 'control',
			payload: { includeOffline: input.includeOffline },
		});
		const message = await clientPort.waitForMessage(
			(candidate) => candidate.type === 'workers:list:result',
			10_000,
		);
		const resultPayload = parseWorkersListResultPayload(message.payload);
		if (!resultPayload) {
			throw new Error('Invalid workers:list:result payload');
		}
		return resultPayload.workers;
	};

	const sendDirectRequest = async (
		input: ISendDirectRequestInput,
	): Promise<IDirectResponsePayload> => {
		const requestId = nanoid();
		let timeout: ReturnType<typeof setTimeout> | null = null;
		let unsub: (() => void) | null = null;

		const cleanup = () => {
			if (timeout) {
				clearTimeout(timeout);
				timeout = null;
			}
			if (unsub) {
				unsub();
				unsub = null;
			}
		};

		const result = new Promise<IDirectResponsePayload>((resolve, reject) => {
			unsub = clientPort.subscribe((message) => {
				if (message.type === 'direct:response') {
					const payload = parseDirectResponsePayload(message.payload);
					if (!payload || payload.requestId !== requestId) {
						return;
					}
					if (payload.ackKind === 'queued' || payload.reasonCode === 'queued') {
						return;
					}
					cleanup();
					resolve(payload);
					return;
				}

				if (message.type === 'control:error') {
					cleanup();
					reject(new Error((message.payload as IProtocolErrorPayload).message));
				}
			});

			const timeoutMs = input.timeoutMs ?? 10 * 60_000;
			timeout = setTimeout(() => {
				cleanup();
				reject(new Error('Direct request timed out'));
			}, timeoutMs);
		});

		await send({
			type: 'direct:request',
			channel: `direct:${requestId}`,
			payload: {
				requestId,
				...input,
			},
		});

		return await result;
	};

	const publishBatch = async (
		input: IPublishBatchInput,
	): Promise<ITaskPublishBatchResultPayload> => {
		const planId = input.planId ?? nanoid();
		await send({
			type: 'task:publish-batch',
			channel: `task:${planId}`,
			payload: { planId, nodes: input.nodes, atomic: input.atomic },
		});
		const message = await clientPort.waitForMessage(
			(candidate) =>
				candidate.type === 'task:publish-batch:result' &&
				(candidate.payload as { planId?: string }).planId === planId,
			input.timeoutMs ?? 30_000,
		);
		const parsed = parseTaskPublishBatchResultPayload(message.payload);
		if (!parsed) {
			throw new Error('Invalid task:publish-batch:result payload');
		}
		return parsed;
	};

	const getChildrenStatus = async (
		input: IGetChildrenStatusInput,
	): Promise<ITaskChildrenStatusResultPayload> => {
		const requestId = nanoid();
		await send({
			type: 'task:children:status',
			channel: `task:${input.parentTaskId}`,
			payload: {
				requestId,
				parentTaskId: input.parentTaskId,
				includeArtifacts: input.includeArtifacts,
			},
		});
		const message = await clientPort.waitForMessage(
			(candidate) =>
				candidate.type === 'task:children:status:result' &&
				(candidate.payload as { requestId?: string }).requestId === requestId,
			input.timeoutMs ?? 30_000,
		);
		const parsed = parseTaskChildrenStatusResultPayload(message.payload);
		if (!parsed) {
			throw new Error('Invalid task:children:status:result payload');
		}
		return parsed;
	};

	return {
		assignTask,
		listWorkers,
		sendDirectRequest,
		publishBatch,
		getChildrenStatus,
		close: () => clientPort.close(),
	} satisfies IHostSession;
};
