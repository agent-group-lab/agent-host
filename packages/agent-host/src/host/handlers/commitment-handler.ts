import type { CommitmentAction } from '@agent-group-lab/contracts/agent';
import {
	type ICommitmentActionPayload,
	type ITaskAcceptedPayload,
	type ITaskEscalatedPayload,
	TASK_ACCEPTED,
	TASK_COMPLETED,
	TASK_ESCALATED,
	TASK_FAILED,
} from '@agent-group-lab/contracts/messages';
import type {
	IProtocolEnvelope,
	IProtocolErrorPayload,
} from '@agent-group-lab/protocol';
import { nanoid } from 'nanoid';
import {
	type CommitmentStatus,
	createCommitmentRecord,
	updateCommitmentProgress,
} from '~/domain/commitment';
import { createDelegationRecord } from '~/domain/delegation';
import { getRolePolicy } from '~/policy/role-policy';
import { selectWorkerForTask } from '~/policy/scheduler';
import type { IHostPortConnection } from '~/ports/host-server-port';
import type { IHostStore } from '~/store/store';
import type {
	IConnectionContext,
	ILiveConnectionState,
} from '../infra/connection-manager';
import type { AgreementService } from '../services/agreement-service';
import type { TaskBoardService } from '../services/task-board-service';
import type { TaskNotificationService } from '../services/task-notification-service';
import type { WorkQueueService } from '../services/work-queue-service';
import type { WorkerLifecycleService } from '../services/worker-lifecycle-service';

interface ICommitmentHandlerOptions {
	store: IHostStore;
	getLiveConnection: (connectionId: string) => ILiveConnectionState | undefined;
	taskBoardService: TaskBoardService;
	agreementService: AgreementService;
	notificationService: TaskNotificationService;
	workQueueService: WorkQueueService;
	workerLifecycleService: WorkerLifecycleService;
	publishCommitmentUpdated: (
		task: { taskId: string; turnId: string; requesterConnectionId: string },
		agentId: string,
		action: CommitmentAction,
		status: CommitmentStatus,
	) => Promise<void>;
	sendProtocolError: (
		connection: IHostPortConnection,
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
	dispatchNextWorkForWorker: (agentId: string) => Promise<void>;
}

export class CommitmentHandler {
	private readonly options: ICommitmentHandlerOptions;

	constructor(options: ICommitmentHandlerOptions) {
		this.options = options;
	}

	handleCommitmentAction = async (
		context: IConnectionContext,
		parsed: ICommitmentActionPayload,
	) => {
		if (context.meta.connectionRole !== 'worker' || !context.meta.agentId) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'Only worker connection can send commitment:action',
			);
			return;
		}

		const worker = this.options.store.getWorker(context.meta.agentId);
		if (!worker) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				`Worker ${context.meta.agentId} not found`,
			);
			return;
		}

		const task = this.options.store.getTaskBoardEntry(parsed.taskId);
		if (!task) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				`Task ${parsed.taskId} not found`,
			);
			return;
		}
		if (task.assigneeId !== worker.agentId) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'Worker mismatch for commitment:action',
				{ taskId: parsed.taskId, agentId: worker.agentId },
			);
			return;
		}

		const policy = getRolePolicy(worker.agentRole);
		if (!policy.allowedActions.has(parsed.action)) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				`Role '${worker.agentRole}' cannot perform action '${parsed.action}'`,
			);
			return;
		}

		const now = Date.now();
		let commitment = this.options.store.getCommitmentByTaskId(parsed.taskId);
		const activeDelegation =
			this.options.agreementService.findActiveDelegationByTask(
				parsed.taskId,
				worker.agentId,
			);

		if (parsed.action === 'ACCEPT') {
			if (!commitment) {
				commitment = createCommitmentRecord({
					commitmentId: nanoid(),
					taskId: parsed.taskId,
					assigneeId: worker.agentId,
					assigneeName: worker.agentName,
					deliverableSpec: parsed.deliverableSpec,
					slaDeadline: parsed.slaDeadline,
				});
			}
			if (commitment.assigneeId !== worker.agentId) {
				await this.options.sendProtocolError(
					context.live.connection,
					'protocol',
					`Commitment assignee mismatch for task ${parsed.taskId}`,
				);
				return;
			}
			if (commitment.status !== 'none') {
				await this.options.sendProtocolError(
					context.live.connection,
					'protocol',
					`Task ${parsed.taskId} has already been accepted`,
				);
				return;
			}

			this.options.agreementService.applyCommitmentTransition({
				commitment: {
					...commitment,
					deliverableSpec: parsed.deliverableSpec ?? commitment.deliverableSpec,
					slaDeadline: parsed.slaDeadline ?? commitment.slaDeadline,
				},
				nextStatus: 'accepted',
				at: now,
				eventContext: {
					actor: worker.agentId,
					actorName: worker.agentName,
					metadata: {
						taskId: commitment.taskId,
						assigneeId: commitment.assigneeId,
						delegatedBy: commitment.delegatedBy,
					},
				},
			});
			if (activeDelegation && activeDelegation.status === 'pending') {
				this.options.agreementService.applyDelegationTransition({
					delegation: activeDelegation,
					nextStatus: 'accepted',
					at: now,
					eventContext: {
						actor: worker.agentId,
						actorName: worker.agentName,
						metadata: {
							delegatorId: activeDelegation.delegatorId,
							delegateeId: activeDelegation.delegateeId,
							taskId: activeDelegation.delegatedTaskId,
						},
					},
				});
			}
			this.options.taskBoardService.markDoing(task.taskId, now);

			const acceptedPayload: ITaskAcceptedPayload = {
				taskId: task.taskId,
				agentId: worker.agentId,
				agentName: worker.agentName,
			};
			await this.options.sendToConnection(task.requesterConnectionId, {
				type: TASK_ACCEPTED,
				channel: `task:${task.taskId}`,
				trace: {
					taskId: task.taskId,
					turnId: task.turnId,
				},
				payload: acceptedPayload,
			});
			return;
		}

		if (!commitment) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				`Task ${parsed.taskId} has no active commitment`,
			);
			return;
		}
		if (commitment.assigneeId !== worker.agentId) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				`Commitment assignee mismatch for task ${parsed.taskId}`,
			);
			return;
		}

		if (parsed.action === 'UPDATE') {
			if (commitment.status !== 'accepted') {
				await this.options.sendProtocolError(
					context.live.connection,
					'protocol',
					`Task ${parsed.taskId} is not in accepted commitment state`,
				);
				return;
			}
			const updatedCommitment = updateCommitmentProgress({
				commitment,
				progress: parsed.progress,
			});
			this.options.store.setCommitment(updatedCommitment);
			await this.options.publishCommitmentUpdated(
				{
					taskId: task.taskId,
					turnId: task.turnId,
					requesterConnectionId: task.requesterConnectionId,
				},
				worker.agentId,
				parsed.action,
				updatedCommitment.status,
			);
			return;
		}

		if (parsed.action === 'ESCALATE') {
			const escalatedPayload: ITaskEscalatedPayload = {
				taskId: task.taskId,
				agentId: worker.agentId,
				agentName: worker.agentName,
				decisionNeeded: parsed.decisionNeeded,
			};
			await this.options.sendToConnection(task.requesterConnectionId, {
				type: TASK_ESCALATED,
				channel: `task:${task.taskId}`,
				trace: {
					taskId: task.taskId,
					turnId: task.turnId,
				},
				payload: escalatedPayload,
			});
			await this.options.publishCommitmentUpdated(
				{
					taskId: task.taskId,
					turnId: task.turnId,
					requesterConnectionId: task.requesterConnectionId,
				},
				worker.agentId,
				parsed.action,
				commitment.status,
			);
			return;
		}

		if (parsed.action === 'DECLINE') {
			if (
				activeDelegation &&
				(activeDelegation.status === 'pending' ||
					activeDelegation.status === 'accepted')
			) {
				this.options.agreementService.applyDelegationTransition({
					delegation: activeDelegation,
					nextStatus: 'rejected',
					at: now,
					eventContext: {
						actor: worker.agentId,
						actorName: worker.agentName,
						metadata: {
							delegatorId: activeDelegation.delegatorId,
							delegateeId: activeDelegation.delegateeId,
							taskId: activeDelegation.delegatedTaskId,
						},
					},
				});
			}
			const selection = selectWorkerForTask({
				workers: this.options.store
					.listWorkers()
					.filter((item) => item.agentId !== worker.agentId),
				requestedAgentId: parsed.suggestedAssignee,
			});
			this.options.store.deleteCommitment(commitment.commitmentId);
			await this.options.publishCommitmentUpdated(
				{
					taskId: task.taskId,
					turnId: task.turnId,
					requesterConnectionId: task.requesterConnectionId,
				},
				worker.agentId,
				parsed.action,
				'none',
			);

			const selectedWorker = selection.worker;
			const selectedConnection = selectedWorker
				? selectedWorker.connectionId
					? this.options.getLiveConnection(selectedWorker.connectionId)
					: undefined
				: undefined;
			if (!selectedWorker || !selectedConnection) {
				this.options.taskBoardService.markCancelled(
					task.taskId,
					`Declined: ${parsed.reason}`,
					now,
				);
				this.options.notificationService.finishTask({
					taskId: task.taskId,
					assigneeId: worker.agentId,
				});
				await this.options.sendToConnection(task.requesterConnectionId, {
					type: TASK_FAILED,
					channel: `task:${task.taskId}`,
					trace: {
						taskId: task.taskId,
						turnId: task.turnId,
					},
					payload: {
						taskId: task.taskId,
						agentId: worker.agentId,
						agentName: worker.agentName,
						message: `Declined: ${parsed.reason}`,
					},
				});
				return;
			}

			this.options.taskBoardService.reassign(
				task.taskId,
				selectedWorker.agentId,
				selectedWorker.agentName,
			);
			const reassignedTask = this.options.store.getTaskBoardEntry(task.taskId);
			if (reassignedTask) {
				this.options.workQueueService.ensureTaskWorkQueued(
					reassignedTask,
					worker.agentId,
					worker.agentName,
				);
			}
			if (activeDelegation) {
				const reassignedDelegation = createDelegationRecord(
					{
						delegationId: nanoid(),
						delegatorId: activeDelegation.delegatorId,
						delegateeId: selectedWorker.agentId,
						originalTaskId: activeDelegation.originalTaskId,
						delegatedTaskId: activeDelegation.delegatedTaskId,
					},
					now,
				);
				this.options.store.setDelegation(reassignedDelegation);
			}
			this.options.workerLifecycleService.recoverWorkerToIdle(
				worker.agentId,
				task.taskId,
			);
			await this.options.dispatchNextWorkForWorker(selectedWorker.agentId);
			return;
		}

		if (commitment.status !== 'accepted') {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				`Task ${parsed.taskId} is not in accepted commitment state`,
			);
			return;
		}

		if (parsed.action === 'DELIVER') {
			this.options.agreementService.applyCommitmentTransition({
				commitment,
				nextStatus: 'delivered',
				artifact: parsed.artifact,
				at: now,
				eventContext: {
					actor: worker.agentId,
					actorName: worker.agentName,
					metadata: {
						taskId: commitment.taskId,
						assigneeId: commitment.assigneeId,
						delegatedBy: commitment.delegatedBy,
					},
				},
			});
			if (activeDelegation && activeDelegation.status === 'accepted') {
				this.options.agreementService.applyDelegationTransition({
					delegation: activeDelegation,
					nextStatus: 'completed',
					at: now,
					eventContext: {
						actor: worker.agentId,
						actorName: worker.agentName,
						metadata: {
							delegatorId: activeDelegation.delegatorId,
							delegateeId: activeDelegation.delegateeId,
							taskId: activeDelegation.delegatedTaskId,
						},
					},
				});
			}

			const unlockedTaskIds = this.options.taskBoardService.markDone(
				task.taskId,
				parsed.artifact,
				now,
			);
			this.options.workQueueService.completeTaskWork(task.taskId, 'completed');
			for (const id of unlockedTaskIds) {
				const unlockedTask = this.options.store.getTaskBoardEntry(id);
				if (!unlockedTask?.assigneeId) {
					continue;
				}
				this.options.workQueueService.ensureTaskWorkQueued(
					unlockedTask,
					worker.agentId,
					worker.agentName,
				);
				await this.options.dispatchNextWorkForWorker(unlockedTask.assigneeId);
			}

			await this.options.notificationService.notifyParentTaskChildDelivered({
				childTaskId: task.taskId,
				childAssigneeId: worker.agentId,
				childAssigneeName: worker.agentName,
				artifact: parsed.artifact,
			});

			this.options.notificationService.finishTask({
				taskId: task.taskId,
				assigneeId: worker.agentId,
			});
			await this.options.sendToConnection(task.requesterConnectionId, {
				type: TASK_COMPLETED,
				channel: `task:${task.taskId}`,
				trace: {
					taskId: task.taskId,
					turnId: task.turnId,
				},
				payload: {
					taskId: task.taskId,
					agentId: worker.agentId,
					agentName: worker.agentName,
				},
			});
			return;
		}
		if (parsed.action !== 'FAIL') {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'Unsupported commitment action for accepted commitment',
			);
			return;
		}

		this.options.agreementService.applyCommitmentTransition({
			commitment,
			nextStatus: 'failed',
			failureReason: parsed.reason,
			at: now,
			eventContext: {
				actor: worker.agentId,
				actorName: worker.agentName,
				metadata: {
					taskId: commitment.taskId,
					assigneeId: commitment.assigneeId,
					delegatedBy: commitment.delegatedBy,
				},
			},
		});
		if (
			activeDelegation &&
			(activeDelegation.status === 'pending' ||
				activeDelegation.status === 'accepted')
		) {
			this.options.agreementService.applyDelegationTransition({
				delegation: activeDelegation,
				nextStatus: 'rejected',
				at: now,
				eventContext: {
					actor: worker.agentId,
					actorName: worker.agentName,
					metadata: {
						delegatorId: activeDelegation.delegatorId,
						delegateeId: activeDelegation.delegateeId,
						taskId: activeDelegation.delegatedTaskId,
					},
				},
			});
		}
		this.options.taskBoardService.markCancelled(
			task.taskId,
			parsed.reason,
			now,
		);
		this.options.workQueueService.completeTaskWork(task.taskId, 'dropped');
		this.options.notificationService.finishTask({
			taskId: task.taskId,
			assigneeId: worker.agentId,
		});
		await this.options.sendToConnection(task.requesterConnectionId, {
			type: TASK_FAILED,
			channel: `task:${task.taskId}`,
			trace: {
				taskId: task.taskId,
				turnId: task.turnId,
			},
			payload: {
				taskId: task.taskId,
				agentId: worker.agentId,
				agentName: worker.agentName,
				message: parsed.reason,
			},
		});
	};
}
