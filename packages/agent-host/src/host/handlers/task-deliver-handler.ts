import {
	type ITaskCompletedPayload,
	type ITaskDeliverPayload,
	type ITaskDeliverResultPayload,
	TASK_COMPLETED,
	TASK_DELIVER_RESULT,
} from '@agent-group-lab/contracts/messages';
import type { WorkState } from '@agent-group-lab/contracts/work';
import type {
	IProtocolEnvelope,
	IProtocolErrorPayload,
} from '@agent-group-lab/protocol';
import type { ICommitmentRecord } from '~/domain/commitment';
import type { ITaskBoardEntry } from '~/domain/task-board';
import type { IHostStore } from '~/store/store';
import type { IConnectionContext } from '../infra/connection-manager';
import type { AgreementService } from '../services/agreement-service';
import type { TaskBoardService } from '../services/task-board-service';
import type { TaskNotificationService } from '../services/task-notification-service';

interface ITaskDeliverHandlerOptions {
	store: IHostStore;
	sendProtocolError: (
		connection: IConnectionContext['live']['connection'],
		code: IProtocolErrorPayload['code'],
		message: string,
		details?: Record<string, unknown>,
	) => Promise<void>;
	sendToConnection: (
		connectionId: string,
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => Promise<void>;
	taskBoardService: TaskBoardService;
	agreementService: AgreementService;
	notificationService: TaskNotificationService;
	dispatchNextWorkForWorker: (agentId: string) => Promise<void>;
	transitionWorkerState: (agentId: string, nextState: WorkState) => void;
	forceWorkerState: (agentId: string, nextState: WorkState) => void;
}

export class TaskDeliverHandler {
	private readonly options: ITaskDeliverHandlerOptions;

	constructor(options: ITaskDeliverHandlerOptions) {
		this.options = options;
	}

	handleTaskDeliver = async (
		context: IConnectionContext,
		parsed: ITaskDeliverPayload,
	) => {
		if (context.meta.connectionRole !== 'worker' || !context.meta.agentId) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'Only worker can deliver tasks',
			);
			return;
		}

		const { connectionId } = context.meta;
		const agentId = context.meta.agentId;
		const task = this.options.store.getTaskBoardEntry(parsed.taskId);
		if (!task) {
			await this.sendResult(connectionId, {
				requestId: parsed.requestId,
				status: 'rejected',
				reason: `Task ${parsed.taskId} not found`,
			});
			return;
		}

		const commitment = this.options.store.getCommitmentByTaskId(parsed.taskId);

		if (commitment?.status === 'delivered' && task.status === 'done') {
			await this.sendResult(connectionId, {
				requestId: parsed.requestId,
				status: 'delivered',
			});
			return;
		}

		// Post-requeue: original worker delivers before any new worker claims
		if (
			task.status === 'todo' &&
			task.lastAssignmentToken === parsed.assignmentToken &&
			commitment?.assigneeId === agentId
		) {
			await this.executeDelivery(connectionId, agentId, task, parsed, null);
			return;
		}

		// Normal delivery — validate then execute
		if (task.status !== 'doing') {
			await this.sendResult(connectionId, {
				requestId: parsed.requestId,
				status: 'rejected',
				reason: `Task ${parsed.taskId} is not doing`,
			});
			return;
		}
		if (task.assigneeId !== agentId) {
			await this.sendResult(connectionId, {
				requestId: parsed.requestId,
				status: 'conflict',
				reason: `Task ${parsed.taskId} is assigned to another worker`,
			});
			return;
		}
		if (task.assignmentToken !== parsed.assignmentToken) {
			await this.sendResult(connectionId, {
				requestId: parsed.requestId,
				status: 'conflict',
				reason: 'Assignment token mismatch',
			});
			return;
		}
		if (!commitment || commitment.status !== 'accepted') {
			await this.sendResult(connectionId, {
				requestId: parsed.requestId,
				status: 'rejected',
				reason: `Task ${parsed.taskId} has no accepted commitment`,
			});
			return;
		}

		await this.executeDelivery(connectionId, agentId, task, parsed, commitment);
	};

	/**
	 * Shared delivery completion logic for both the normal path and the
	 * post-requeue path. Pass `commitment = null` when the task was requeued
	 * and no commitment transition is needed.
	 */
	private executeDelivery = async (
		connectionId: string,
		agentId: string,
		task: ITaskBoardEntry,
		parsed: ITaskDeliverPayload,
		commitment: ICommitmentRecord | null,
	) => {
		const now = Date.now();
		const unlockedTaskIds = this.options.taskBoardService.markDone(
			task.taskId,
			parsed.artifact,
			now,
		);

		let responseRequestId = parsed.requestId;
		if (commitment) {
			const deliveredCommitment =
				this.options.agreementService.applyCommitmentTransition({
					commitment,
					nextStatus: 'delivered',
					artifact: parsed.artifact,
					deliveredRequestId: parsed.requestId,
					at: now,
					eventContext: {
						actor: agentId,
						actorName: task.assigneeName,
						metadata: {
							taskId: commitment.taskId,
							assigneeId: commitment.assigneeId,
							delegatedBy: commitment.delegatedBy,
						},
					},
				});
			responseRequestId =
				deliveredCommitment.deliveredRequestId ?? parsed.requestId;
		}

		this.recoverWorkerToIdle(agentId, task.taskId);

		this.options
			.sendToConnection(task.requesterConnectionId, {
				type: TASK_COMPLETED,
				channel: `task:${task.taskId}`,
				trace: {
					taskId: task.taskId,
					turnId: task.turnId,
				},
				payload: {
					taskId: task.taskId,
					agentId,
					agentName: task.assigneeName ?? agentId,
				} satisfies ITaskCompletedPayload,
			})
			.catch(() => {
				// requester 已断开时静默忽略，delivery 结果不应回滚
			});

		await this.options.notificationService.notifyParentTaskChildDelivered({
			childTaskId: task.taskId,
			childAssigneeId: agentId,
			childAssigneeName: task.assigneeName ?? agentId,
			artifact: parsed.artifact,
		});

		for (const unlockedTaskId of unlockedTaskIds) {
			const unlockedTask = this.options.store.getTaskBoardEntry(unlockedTaskId);
			if (!unlockedTask?.assigneeId) {
				continue;
			}
			const unlockedWorker = this.options.store.getWorker(
				unlockedTask.assigneeId,
			);
			if (!unlockedWorker || unlockedWorker.workerType === 'session') {
				continue;
			}
			await this.options.dispatchNextWorkForWorker(unlockedWorker.agentId);
		}

		await this.sendResult(connectionId, {
			requestId: responseRequestId,
			status: 'delivered',
		});
	};

	private recoverWorkerToIdle = (agentId: string, taskId: string) => {
		try {
			this.options.transitionWorkerState(agentId, {
				kind: 'finished',
				taskId,
			});
			this.options.transitionWorkerState(agentId, { kind: 'idle' });
		} catch {
			this.options.forceWorkerState(agentId, { kind: 'idle' });
		}
	};

	private sendResult = async (
		connectionId: string,
		payload: ITaskDeliverResultPayload,
	) => {
		await this.options.sendToConnection(connectionId, {
			type: TASK_DELIVER_RESULT,
			channel: `task:${payload.requestId}`,
			payload,
		});
	};
}
