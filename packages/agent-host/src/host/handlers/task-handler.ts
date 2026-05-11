import {
	type ITaskAssignPayload,
	type ITaskCompletedPayload,
	type ITaskFailedPayload,
	TASK_COMPLETED,
	TASK_FAILED,
} from '@agent-group-lab/contracts/messages';
import type {
	IProtocolEnvelope,
	IProtocolErrorPayload,
} from '@agent-group-lab/protocol';
import { nanoid } from 'nanoid';
import { createDelegationRecord } from '~/domain/delegation';
import { createTaskBoardEntry } from '~/domain/task-board';
import { getRolePolicy } from '~/policy/role-policy';
import { selectWorkerForTask } from '~/policy/scheduler';
import type { IHostPortConnection } from '~/ports/host-server-port';
import type { IConnectionMeta, IHostStore } from '~/store/store';
import type {
	IConnectionContext,
	ILiveConnectionState,
} from '../infra/connection-manager';
import type { TaskBoardService } from '../services/task-board-service';
import type { TaskNotificationService } from '../services/task-notification-service';
import type { WorkQueueService } from '../services/work-queue-service';

interface ITaskHandlerOptions {
	store: IHostStore;
	taskClaimV2Enabled: boolean;
	getLiveConnection: (connectionId: string) => ILiveConnectionState | undefined;
	sendProtocolError: (
		connection: IHostPortConnection,
		code: IProtocolErrorPayload['code'],
		message: string,
		details?: Record<string, unknown>,
	) => Promise<void>;
	updateConnectionMeta: (
		connectionId: string,
		updates: Partial<IConnectionMeta>,
	) => void;
	markWorkerOffline: (agentId: string) => void;
	taskBoardService: TaskBoardService;
	notificationService: TaskNotificationService;
	workQueueService: WorkQueueService;
	dispatchNextWorkForWorker: (agentId: string) => Promise<void>;
	sendToConnection: (
		connectionId: string,
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => Promise<void>;
}

export class TaskHandler {
	private readonly options: ITaskHandlerOptions;

	constructor(options: ITaskHandlerOptions) {
		this.options = options;
	}

	handleTaskAssign = async (
		context: IConnectionContext,
		parsed: ITaskAssignPayload,
	) => {
		const isWorkerRequester = context.meta.connectionRole === 'worker';
		const isClaimDispatch = parsed.dispatchMode === 'claim';
		const requesterWorker = isWorkerRequester
			? this.options.store.getWorker(context.meta.agentId ?? '')
			: undefined;
		let isDelegationRequest = false;
		if (isWorkerRequester) {
			if (!context.meta.agentId) {
				await this.options.sendProtocolError(
					context.live.connection,
					'protocol',
					'Worker identity missing for task:assign',
				);
				return;
			}
			if (!requesterWorker) {
				await this.options.sendProtocolError(
					context.live.connection,
					'protocol',
					`Requester worker ${context.meta.agentId} not found`,
				);
				return;
			}
			const requesterPolicy = getRolePolicy(requesterWorker.agentRole);
			const isDelegateExecutor = !requesterPolicy.canAssignTasks;
			if (!requesterPolicy.canAssignTasks) {
				await this.options.sendProtocolError(
					context.live.connection,
					'protocol',
					'Only lead worker or executor can assign tasks',
				);
				return;
			}
			if (!parsed.agentId && !isClaimDispatch) {
				await this.options.sendProtocolError(
					context.live.connection,
					'protocol',
					'Worker task:assign requires explicit agentId',
				);
				return;
			}
			if (!isClaimDispatch && parsed.agentId === requesterWorker.agentId) {
				await this.options.sendProtocolError(
					context.live.connection,
					'protocol',
					'Delegation target cannot be self',
				);
				return;
			}
			if (isDelegateExecutor) {
				if (!parsed.parentTaskId) {
					await this.options.sendProtocolError(
						context.live.connection,
						'protocol',
						'Executor task:assign requires parentTaskId',
					);
					return;
				}
				const parentCommitment = this.options.store.getCommitmentByTaskId(
					parsed.parentTaskId,
				);
				if (
					!parentCommitment ||
					parentCommitment.assigneeId !== requesterWorker.agentId ||
					parentCommitment.status !== 'accepted'
				) {
					await this.options.sendProtocolError(
						context.live.connection,
						'protocol',
						'Executor can only delegate from accepted parent task',
					);
					return;
				}
			}
		}

		if (context.meta.connectionRole === 'unknown') {
			this.options.updateConnectionMeta(context.meta.connectionId, {
				connectionRole: 'client',
			});
		}

		if (this.options.store.getTaskBoardEntry(parsed.taskId)) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				`Task ${parsed.taskId} already exists`,
				{ taskId: parsed.taskId },
			);
			return;
		}
		if (parsed.parentTaskId) {
			const parentEntry = this.options.store.getTaskBoardEntry(
				parsed.parentTaskId,
			);
			if (!parentEntry) {
				await this.options.sendProtocolError(
					context.live.connection,
					'protocol',
					`Parent task ${parsed.parentTaskId} not found`,
				);
				return;
			}
			isDelegationRequest = isWorkerRequester;
		}

		if (isClaimDispatch) {
			if (!this.options.taskClaimV2Enabled) {
				await this.options.sendProtocolError(
					context.live.connection,
					'protocol',
					'task:assign dispatchMode=claim is disabled',
				);
				return;
			}
			let taskBoardEntry: ReturnType<typeof createTaskBoardEntry>;
			try {
				taskBoardEntry = createTaskBoardEntry(
					{
						taskId: parsed.taskId,
						turnId: parsed.turnId,
						prompt: parsed.prompt,
						workingDirectory: parsed.workingDirectory,
						requesterConnectionId: context.meta.connectionId,
						requesterAgentId: context.meta.agentId,
						parentTaskId: parsed.parentTaskId,
						dependencies: parsed.dependencies ?? [],
						deliverableSpec: parsed.deliverableSpec,
						slaDeadline: parsed.slaDeadline,
						dispatchMode: 'claim',
						assignmentToken: parsed.assignmentToken,
					},
					{
						existingTasks: this.options.taskBoardService.getTaskBoardMap(),
					},
				);
			} catch (error) {
				await this.options.sendProtocolError(
					context.live.connection,
					'protocol',
					error instanceof Error ? error.message : 'Invalid task dependencies',
					{ taskId: parsed.taskId },
				);
				return;
			}
			this.options.store.setTaskBoardEntry(taskBoardEntry);
			return;
		}

		const workerSelection = selectWorkerForTask({
			workers: this.options.store
				.listWorkers()
				.filter((worker) => worker.connectionId !== undefined),
			requestedAgentId: parsed.agentId,
			requiredRole: !isWorkerRequester && !parsed.agentId ? 'lead' : undefined,
		});
		if (!workerSelection.worker) {
			await this.options.sendProtocolError(
				context.live.connection,
				'retryable',
				workerSelection.error ?? 'No worker available',
				{ taskId: parsed.taskId },
			);
			return;
		}

		const workerRecord = workerSelection.worker;
		if (!workerRecord.connectionId) {
			await this.options.sendProtocolError(
				context.live.connection,
				'retryable',
				`Selected worker ${workerRecord.agentId} is not pushable`,
				{ taskId: parsed.taskId },
			);
			return;
		}
		const workerConnection = this.options.getLiveConnection(
			workerRecord.connectionId,
		);
		if (!workerConnection) {
			this.options.markWorkerOffline(workerRecord.agentId);
			await this.options.sendProtocolError(
				context.live.connection,
				'retryable',
				`Selected worker ${workerRecord.agentId} is disconnected`,
				{ taskId: parsed.taskId },
			);
			return;
		}

		let taskBoardEntry: ReturnType<typeof createTaskBoardEntry>;
		try {
			taskBoardEntry = createTaskBoardEntry(
				{
					taskId: parsed.taskId,
					turnId: parsed.turnId,
					prompt: parsed.prompt,
					workingDirectory: parsed.workingDirectory,
					requesterConnectionId: context.meta.connectionId,
					requesterAgentId: context.meta.agentId,
					parentTaskId: parsed.parentTaskId,
					assigneeId: workerRecord.agentId,
					assigneeName: workerRecord.agentName,
					assigneeRole: workerRecord.agentRole,
					dependencies: parsed.dependencies ?? [],
					deliverableSpec: parsed.deliverableSpec,
					slaDeadline: parsed.slaDeadline,
					dispatchMode: 'push',
					assignmentToken: parsed.assignmentToken,
				},
				{
					existingTasks: this.options.taskBoardService.getTaskBoardMap(),
				},
			);
		} catch (error) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				error instanceof Error ? error.message : 'Invalid task dependencies',
				{ taskId: parsed.taskId },
			);
			return;
		}
		this.options.store.setTaskBoardEntry(taskBoardEntry);
		if (isDelegationRequest && requesterWorker && parsed.parentTaskId) {
			const delegation = createDelegationRecord({
				delegationId: nanoid(),
				delegatorId: requesterWorker.agentId,
				delegateeId: workerRecord.agentId,
				originalTaskId: parsed.parentTaskId,
				delegatedTaskId: parsed.taskId,
			});
			this.options.store.setDelegation(delegation);
		}
		if (taskBoardEntry.status === 'blocked') {
			return;
		}

		this.options.workQueueService.ensureTaskWorkQueued(
			taskBoardEntry,
			context.meta.agentId ?? `connection:${context.meta.connectionId}`,
			requesterWorker?.agentName,
		);
		await this.options.dispatchNextWorkForWorker(workerRecord.agentId);
	};

	handleTaskCompleted = async (
		context: IConnectionContext,
		parsed: ITaskCompletedPayload,
	) => {
		if (context.meta.connectionRole !== 'worker') {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'Only worker connection can send task:completed',
			);
			return;
		}

		const taskBoard = this.options.store.getTaskBoardEntry(parsed.taskId);
		if (!taskBoard) {
			return;
		}
		if (
			context.meta.agentId !== parsed.agentId ||
			taskBoard.assigneeId !== parsed.agentId
		) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'Worker mismatch for task completion',
				{ taskId: parsed.taskId, agentId: parsed.agentId },
			);
			return;
		}

		const unlockedTaskIds = this.options.taskBoardService.markDone(
			parsed.taskId,
			parsed.artifact,
		);
		this.options.workQueueService.completeTaskWork(parsed.taskId, 'completed');
		for (const id of unlockedTaskIds) {
			const unlockedTask = this.options.store.getTaskBoardEntry(id);
			if (!unlockedTask?.assigneeId) {
				continue;
			}
			this.options.workQueueService.ensureTaskWorkQueued(
				unlockedTask,
				parsed.agentId,
				parsed.agentName,
			);
			await this.options.dispatchNextWorkForWorker(unlockedTask.assigneeId);
		}

		await this.options.notificationService.notifyParentTaskChildDelivered({
			childTaskId: parsed.taskId,
			childAssigneeId: parsed.agentId,
			childAssigneeName: parsed.agentName,
			artifact: parsed.artifact,
		});
		this.options.notificationService.finishTask({
			taskId: parsed.taskId,
			assigneeId: parsed.agentId,
		});
		await this.options.sendToConnection(taskBoard.requesterConnectionId, {
			type: TASK_COMPLETED,
			channel: `task:${parsed.taskId}`,
			trace: {
				taskId: parsed.taskId,
				turnId: taskBoard.turnId,
			},
			payload: parsed,
		});
	};

	handleTaskFailed = async (
		context: IConnectionContext,
		parsed: ITaskFailedPayload,
	) => {
		if (context.meta.connectionRole !== 'worker') {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'Only worker connection can send task:failed',
			);
			return;
		}

		const taskBoard = this.options.store.getTaskBoardEntry(parsed.taskId);
		if (!taskBoard) {
			return;
		}
		if (
			context.meta.agentId !== parsed.agentId ||
			taskBoard.assigneeId !== parsed.agentId
		) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'Worker mismatch for task failure',
				{ taskId: parsed.taskId, agentId: parsed.agentId },
			);
			return;
		}

		this.options.taskBoardService.markCancelled(parsed.taskId, parsed.message);
		this.options.workQueueService.completeTaskWork(parsed.taskId, 'dropped');
		this.options.notificationService.finishTask({
			taskId: parsed.taskId,
			assigneeId: parsed.agentId,
		});
		await this.options.sendToConnection(taskBoard.requesterConnectionId, {
			type: TASK_FAILED,
			channel: `task:${parsed.taskId}`,
			trace: {
				taskId: parsed.taskId,
				turnId: taskBoard.turnId,
			},
			payload: parsed satisfies ITaskFailedPayload,
		});
	};
}
