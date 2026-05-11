import { cwd } from 'node:process';
import {
	type AgentRole,
	type ITaskAssignPayload,
	parseTaskAcceptedPayload,
	parseTaskCompletedPayload,
	parseTaskFailedPayload,
	TASK_ASSIGN,
} from '@agent-group-lab/contracts/messages';
import type {
	IProtocolEnvelope,
	IProtocolErrorPayload,
} from '@agent-group-lab/protocol';

type IReceivedEnvelope = IProtocolEnvelope<string, Record<string, unknown>>;

import { nanoid } from 'nanoid';
import type { IWorkerClientPort } from '~/ports/worker-client-port';

interface IPendingDelegatedTask {
	taskId: string;
	parentTaskId: string;
	toAgentId: string;
	createdAt: number;
	turnId: string;
	timeoutAt: number;
	timeoutTimer: ReturnType<typeof setTimeout>;
	resolve: (payload: IDelegateTaskResult) => void;
	reject: (error: Error) => void;
	accepted: boolean;
}

export interface IDelegateTaskResult {
	taskId: string;
	toAgentId: string;
	parentTaskId: string;
	status: 'delivered' | 'failed';
	accepted: boolean;
	agentId?: string;
	artifact?: unknown;
	message?: string;
}

interface IDelegationManagerOptions {
	clientPort: IWorkerClientPort;
	createEnvelope: (
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => IProtocolEnvelope<string, unknown>;
	agentId: string;
	workerRole: AgentRole;
	delegateDefaultTimeoutMs: number;
	delegateMaxPendingOutbound: number;
	resolveCurrentSourceTaskId: () => string | undefined;
}

export interface IDelegateTaskInput {
	toAgentId: string;
	toAgentName: string;
	prompt: string;
	deliverableSpec?: string;
	workingDirectory?: string;
	taskId?: string;
	timeoutMs?: number;
}

export class DelegationManager {
	private readonly options: IDelegationManagerOptions;
	private readonly pendingDelegatedTasks = new Map<
		string,
		IPendingDelegatedTask
	>();

	constructor(options: IDelegationManagerOptions) {
		this.options = options;
	}

	delegateTaskAndWait = async (input: IDelegateTaskInput) => {
		const parentTaskId = this.options.resolveCurrentSourceTaskId();
		if (!parentTaskId) {
			throw new Error(
				'delegate_task can only be used during a non-direct task',
			);
		}
		if (
			this.pendingDelegatedTasks.size >= this.options.delegateMaxPendingOutbound
		) {
			throw new Error('Too many pending delegated tasks');
		}

		const toAgentId = input.toAgentId.trim();
		if (!toAgentId) {
			throw new Error('delegate_task requires a non-empty toAgentId');
		}
		const prompt = input.prompt.trim();
		if (!prompt) {
			throw new Error('delegate_task requires a non-empty prompt');
		}

		const timeoutMs =
			typeof input.timeoutMs === 'number' &&
			Number.isFinite(input.timeoutMs) &&
			input.timeoutMs > 0
				? input.timeoutMs
				: this.options.delegateDefaultTimeoutMs;

		const taskId = input.taskId?.trim() || `task_${nanoid(8)}`;
		const turnId = nanoid();
		const createdAt = Date.now();
		const timeoutAt = createdAt + timeoutMs;
		const payload: ITaskAssignPayload = {
			taskId,
			turnId,
			prompt,
			workingDirectory: input.workingDirectory ?? cwd(),
			agentId: toAgentId,
			agentName: input.toAgentName,
			parentTaskId,
			deliverableSpec: input.deliverableSpec?.trim() || undefined,
		};

		const resultPromise = new Promise<IDelegateTaskResult>(
			(resolve, reject) => {
				const timeoutTimer = setTimeout(() => {
					this.pendingDelegatedTasks.delete(taskId);
					// Intentional semantic split:
					// - Timeout resolves with a failed result so tool callers can degrade gracefully.
					// - Lifecycle aborts (close/shutdown) reject via rejectAllPending so callers can fail fast.
					resolve({
						taskId,
						toAgentId,
						parentTaskId,
						status: 'failed',
						accepted: false,
						message: `Delegated task timed out after ${timeoutMs}ms`,
					});
				}, timeoutMs);

				this.pendingDelegatedTasks.set(taskId, {
					taskId,
					parentTaskId,
					toAgentId,
					createdAt,
					turnId,
					timeoutAt,
					timeoutTimer,
					resolve,
					reject,
					accepted: false,
				});
			},
		);

		try {
			await this.options.clientPort.send(
				this.options.createEnvelope({
					type: TASK_ASSIGN,
					channel: `task:${taskId}`,
					trace: {
						taskId,
						turnId,
					},
					payload,
				}),
			);
		} catch (error) {
			const pending = this.pendingDelegatedTasks.get(taskId);
			if (pending) {
				clearTimeout(pending.timeoutTimer);
				this.pendingDelegatedTasks.delete(taskId);
			}
			throw error;
		}

		return await resultPromise;
	};

	handleTaskAccepted = (message: IProtocolEnvelope) => {
		const parsed = parseTaskAcceptedPayload(message.payload);
		if (!parsed) {
			return;
		}
		const pending = this.pendingDelegatedTasks.get(parsed.taskId);
		if (!pending) {
			return;
		}
		pending.accepted = true;
	};

	handleTaskCompleted = (message: IProtocolEnvelope) => {
		const parsed = parseTaskCompletedPayload(message.payload);
		if (!parsed) {
			return;
		}
		const pending = this.pendingDelegatedTasks.get(parsed.taskId);
		if (!pending) {
			return;
		}
		this.finishPendingTask(parsed.taskId, {
			taskId: parsed.taskId,
			toAgentId: pending.toAgentId,
			parentTaskId: pending.parentTaskId,
			status: 'delivered',
			accepted: pending.accepted,
			agentId: parsed.agentId,
			artifact: parsed.artifact,
		});
	};

	handleTaskFailed = (message: IProtocolEnvelope) => {
		const parsed = parseTaskFailedPayload(message.payload);
		if (!parsed) {
			return;
		}
		const pending = this.pendingDelegatedTasks.get(parsed.taskId);
		if (!pending) {
			return;
		}
		this.finishPendingTask(parsed.taskId, {
			taskId: parsed.taskId,
			toAgentId: pending.toAgentId,
			parentTaskId: pending.parentTaskId,
			status: 'failed',
			accepted: pending.accepted,
			agentId: parsed.agentId,
			message: parsed.message,
		});
	};

	handleTaskChildDelivered = (message: IReceivedEnvelope) => {
		const parentTaskId =
			typeof message.payload.parentTaskId === 'string'
				? message.payload.parentTaskId
				: undefined;
		const childTaskId =
			typeof message.payload.childTaskId === 'string'
				? message.payload.childTaskId
				: undefined;
		const childAssigneeId =
			typeof message.payload.childAssigneeId === 'string'
				? message.payload.childAssigneeId
				: undefined;
		if (!parentTaskId || !childTaskId) {
			return;
		}
		const pending = this.pendingDelegatedTasks.get(childTaskId);
		if (!pending || pending.parentTaskId !== parentTaskId) {
			return;
		}
		this.finishPendingTask(childTaskId, {
			taskId: childTaskId,
			toAgentId: pending.toAgentId,
			parentTaskId: pending.parentTaskId,
			status: 'delivered',
			accepted: pending.accepted,
			agentId: childAssigneeId,
			artifact: message.payload.artifact,
		});
	};

	tryResolveByControlError = (payload: IProtocolErrorPayload) => {
		if (!payload.details) {
			return;
		}
		const details = payload.details as Record<string, unknown>;
		const taskId =
			typeof details.taskId === 'string' ? details.taskId : undefined;
		if (!taskId) {
			return;
		}
		const pending = this.pendingDelegatedTasks.get(taskId);
		if (!pending) {
			return;
		}
		this.finishPendingTask(taskId, {
			taskId,
			toAgentId: pending.toAgentId,
			parentTaskId: pending.parentTaskId,
			status: 'failed',
			accepted: pending.accepted,
			message: payload.message,
		});
	};

	rejectAllPending = (error: Error) => {
		// Intentional semantic split with timeout path:
		// close/shutdown is treated as hard abort, so pending promises are rejected.
		for (const pending of this.pendingDelegatedTasks.values()) {
			clearTimeout(pending.timeoutTimer);
			pending.reject(error);
		}
		this.pendingDelegatedTasks.clear();
	};

	private finishPendingTask = (taskId: string, result: IDelegateTaskResult) => {
		const pending = this.pendingDelegatedTasks.get(taskId);
		if (!pending) {
			return;
		}
		clearTimeout(pending.timeoutTimer);
		this.pendingDelegatedTasks.delete(taskId);
		pending.resolve(result);
	};
}
