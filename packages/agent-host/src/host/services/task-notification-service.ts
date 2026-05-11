import {
	type DirectReasonCode,
	type IDirectRequestPayload,
	type ITaskChildDeliveredPayload,
	type ITaskChildrenCompletedPayload,
	TASK_CHILD_DELIVERED,
	TASK_CHILDREN_COMPLETED,
} from '@agent-group-lab/contracts/messages';
import type {
	IProtocolEnvelope,
	IProtocolTrace,
} from '@agent-group-lab/protocol';
import type { IMailbox } from '~/host/infra/mailbox';
import type { IHostStore } from '~/store/store';
import type { WorkQueueService } from './work-queue-service';

interface ITaskNotificationServiceOptions {
	store: IHostStore;
	mailbox: IMailbox;
	workQueueService: WorkQueueService;
	sendToConnection: (
		connectionId: string,
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => Promise<void>;
	sendHostAck: (input: {
		requesterConnectionId: string;
		request: Pick<
			IDirectRequestPayload,
			| 'requestId'
			| 'fromAgentId'
			| 'fromAgentName'
			| 'toAgentId'
			| 'toAgentName'
		>;
		trace: IProtocolTrace | undefined;
		ackKind: 'queued' | 'admission_rejected';
		reasonCode: DirectReasonCode;
		reason: string;
	}) => Promise<void>;
	completeWork: (input: {
		agentId: string;
		workKind: 'task' | 'direct';
		workId: string;
		outcome: 'completed' | 'dropped';
	}) => void;
	log: (message: string) => void;
}

export class TaskNotificationService {
	private readonly options: ITaskNotificationServiceOptions;

	constructor(options: ITaskNotificationServiceOptions) {
		this.options = options;
	}

	finishTask = (task: { taskId: string; assigneeId?: string }) => {
		if (!task.assigneeId) {
			return;
		}
		const taskBoard = this.options.store.getTaskBoardEntry(task.taskId);
		this.options.completeWork({
			agentId: task.assigneeId,
			workKind: 'task',
			workId: task.taskId,
			outcome: taskBoard?.status === 'done' ? 'completed' : 'dropped',
		});
	};

	notifyParentTaskChildDelivered = async (input: {
		childTaskId: string;
		childAssigneeId: string;
		childAssigneeName: string;
		artifact?: unknown;
	}) => {
		const childTask = this.options.store.getTaskBoardEntry(input.childTaskId);
		if (!childTask?.parentTaskId) {
			return;
		}

		const parentTask = this.options.store.getTaskBoardEntry(
			childTask.parentTaskId,
		);
		if (!parentTask?.assigneeId) {
			return;
		}

		const childTasks = this.options.store.getChildTasks(parentTask.taskId);
		const doneChildren = childTasks.filter((task) => task.status === 'done');
		const allChildrenDone =
			childTasks.length > 0 && doneChildren.length === childTasks.length;
		const remainingChildren = childTasks.length - doneChildren.length;

		const parentWorker = this.options.store.getWorker(parentTask.assigneeId);
		if (!parentWorker) {
			return;
		}
		const parentConnectionId = this.options.mailbox.resolve(
			parentTask.assigneeId,
		);

		const childDeliveredPayload: ITaskChildDeliveredPayload = {
			parentTaskId: parentTask.taskId,
			childTaskId: childTask.taskId,
			childAssigneeId: input.childAssigneeId,
			childAssigneeName: input.childAssigneeName,
			artifact: input.artifact,
			remainingChildren,
			allChildrenDone,
		};

		if (parentConnectionId) {
			await this.options.sendToConnection(parentConnectionId, {
				type: TASK_CHILD_DELIVERED,
				channel: `task:${parentTask.taskId}`,
				trace: {
					taskId: parentTask.taskId,
					turnId: parentTask.turnId,
				},
				payload: childDeliveredPayload,
			});
		}

		if (!allChildrenDone) {
			return;
		}
		const childrenCompletedPayload: ITaskChildrenCompletedPayload = {
			parentTaskId: parentTask.taskId,
			parentAssigneeId: parentTask.assigneeId,
			parentAssigneeName: parentWorker.agentName,
			childTaskIds: childTasks.map((task) => task.taskId),
		};
		if (parentConnectionId) {
			await this.options.sendToConnection(parentConnectionId, {
				type: TASK_CHILDREN_COMPLETED,
				channel: `task:${parentTask.taskId}`,
				trace: {
					taskId: parentTask.taskId,
					turnId: parentTask.turnId,
				},
				payload: childrenCompletedPayload,
			});
		}
	};

	notifyRequesterOfFailure = (
		storedPayload: Record<string, unknown>,
		request: IDirectRequestPayload,
	) => {
		const requesterConnectionId =
			typeof storedPayload?.requesterConnectionId === 'string'
				? storedPayload.requesterConnectionId
				: undefined;
		if (!requesterConnectionId) {
			return;
		}
		this.options
			.sendHostAck({
				requesterConnectionId,
				request,
				trace: undefined,
				ackKind: 'admission_rejected',
				reasonCode: 'target_offline',
				reason: 'Failed to deliver queued message',
			})
			.catch((error) => {
				this.options.log(
					`Failed to notify requester about delivery failure: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
	};
}
