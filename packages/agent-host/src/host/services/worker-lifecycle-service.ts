import { TASK_FAILED } from '@agent-group-lab/contracts/messages';
import type { WorkState } from '@agent-group-lab/contracts/work';
import type {
	IProtocolEnvelope,
	IProtocolErrorPayload,
} from '@agent-group-lab/protocol';
import type { IHostStore } from '~/store/store';
import type { TaskBoardService } from './task-board-service';
import type { WorkQueueService } from './work-queue-service';

interface IWorkerLifecycleServiceOptions {
	store: IHostStore;
	taskBoardService: TaskBoardService;
	workQueueService: WorkQueueService;
	transitionWorkerState: (agentId: string, nextState: WorkState) => void;
	forceWorkerState: (agentId: string, workState: WorkState) => void;
	dispatchNextWorkForWorker: (agentId: string) => Promise<void>;
	sendToConnection: (
		connectionId: string,
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => Promise<void>;
	log: (message: string) => void;
}

export class WorkerLifecycleService {
	private readonly options: IWorkerLifecycleServiceOptions;

	constructor(options: IWorkerLifecycleServiceOptions) {
		this.options = options;
	}

	recoverWorkerToIdle = (agentId: string, taskId: string) => {
		try {
			this.options.transitionWorkerState(agentId, {
				kind: 'finished',
				taskId,
			});
			this.options.transitionWorkerState(agentId, { kind: 'idle' });
		} catch {
			this.options.forceWorkerState(agentId, { kind: 'idle' });
		}
		this.options.dispatchNextWorkForWorker(agentId).catch((error) => {
			this.options.log(
				`Failed to dispatch queued work for ${agentId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
	};

	handleWorkerDisconnect = async (input: {
		agentId: string;
		runningTaskId?: string;
		failureMessage?: string;
	}) => {
		const reservedTaskIds = this.options.store
			.listInboxEntries({
				toAgentId: input.agentId,
				status: 'reserved',
			})
			.flatMap((entry) => {
				if (entry.work.workKind !== 'task') {
					return [];
				}
				return [entry.work.payloadRef.taskId];
			});

		this.options.workQueueService.dropInboxEntriesForWorker(input.agentId);

		const affectedTaskIds = new Set<string>(reservedTaskIds);
		if (input.runningTaskId) {
			affectedTaskIds.add(input.runningTaskId);
		}
		if (affectedTaskIds.size === 0) {
			return;
		}

		const failureMessage =
			input.failureMessage ?? 'Worker disconnected while task was running';
		const notifications: Array<Promise<void>> = [];
		for (const taskId of affectedTaskIds) {
			const taskBoard = this.options.store.getTaskBoardEntry(taskId);
			if (!taskBoard || taskBoard.assigneeId !== input.agentId) {
				continue;
			}
			if (
				taskBoard.status !== 'todo' &&
				taskBoard.status !== 'assigned' &&
				taskBoard.status !== 'doing'
			) {
				continue;
			}

			this.options.taskBoardService.markCancelled(taskId, failureMessage);
			notifications.push(
				this.options.sendToConnection(taskBoard.requesterConnectionId, {
					type: TASK_FAILED,
					channel: `task:${taskBoard.taskId}`,
					trace: {
						taskId: taskBoard.taskId,
						turnId: taskBoard.turnId,
					},
					payload: {
						taskId: taskBoard.taskId,
						agentId: input.agentId,
						agentName: input.agentId,
						message: failureMessage,
					},
				}),
			);
			notifications.push(
				this.options.sendToConnection(taskBoard.requesterConnectionId, {
					type: 'control:error',
					channel: 'control',
					trace: {
						taskId: taskBoard.taskId,
						turnId: taskBoard.turnId,
					},
					payload: {
						code: 'fatal',
						message: failureMessage,
						details: {
							agentId: input.agentId,
						},
					} satisfies IProtocolErrorPayload,
				}),
			);
		}
		if (notifications.length === 0) {
			return;
		}

		const notificationsResult = await Promise.allSettled(notifications);
		for (const notification of notificationsResult) {
			if (notification.status === 'rejected') {
				this.options.log(
					`Failed to notify requester about disconnect: ${notification.reason instanceof Error ? notification.reason.message : String(notification.reason)}`,
				);
			}
		}
	};
}
