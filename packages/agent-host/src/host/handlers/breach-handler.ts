import {
	type ITaskFailedPayload,
	TASK_FAILED,
} from '@agent-group-lab/contracts/messages';
import type { ICommitmentRecord } from '~/domain/commitment';
import type { ITaskBoardStore } from '~/store/store';
import type { IMessageGateway } from '../infra/message-gateway';
import type { AgreementService } from '../services/agreement-service';
import type { TaskBoardService } from '../services/task-board-service';
import type { TaskNotificationService } from '../services/task-notification-service';

interface IBreachHandlerOptions {
	store: ITaskBoardStore;
	breachReason: string;
	agreementService: AgreementService;
	taskBoardService: TaskBoardService;
	notificationService: TaskNotificationService;
	messageGateway: IMessageGateway;
}

export class BreachHandler {
	private readonly options: IBreachHandlerOptions;

	constructor(options: IBreachHandlerOptions) {
		this.options = options;
	}

	handleCommitmentBreached = async (commitment: ICommitmentRecord) => {
		if (commitment.status !== 'accepted') {
			return;
		}

		const at = Date.now();
		const breached = this.options.agreementService.applyCommitmentTransition({
			commitment,
			nextStatus: 'breached',
			failureReason: this.options.breachReason,
			at,
			eventContext: {
				actor: commitment.assigneeId,
				actorName: commitment.assigneeName,
				metadata: {
					taskId: commitment.taskId,
					assigneeId: commitment.assigneeId,
					delegatedBy: commitment.delegatedBy,
				},
			},
		});

		const taskBoard = this.options.store.getTaskBoardEntry(breached.taskId);
		if (!taskBoard) {
			return;
		}
		if (taskBoard.status === 'done' || taskBoard.status === 'cancelled') {
			return;
		}

		this.options.taskBoardService.markCancelled(
			taskBoard.taskId,
			`Breach: ${this.options.breachReason}`,
			at,
		);
		this.options.notificationService.finishTask({
			taskId: taskBoard.taskId,
			assigneeId: breached.assigneeId,
		});
		await this.options.messageGateway.sendToConnection(
			taskBoard.requesterConnectionId,
			{
				type: TASK_FAILED,
				channel: `task:${taskBoard.taskId}`,
				trace: {
					taskId: taskBoard.taskId,
					turnId: taskBoard.turnId,
				},
				payload: {
					taskId: taskBoard.taskId,
					agentId: breached.assigneeId,
					agentName: breached.assigneeName ?? breached.assigneeId,
					message: `Breach: ${this.options.breachReason}`,
				} satisfies ITaskFailedPayload,
			},
		);
	};
}
