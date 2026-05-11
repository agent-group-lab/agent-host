import {
	type ITaskAcceptedPayload,
	TASK_ACCEPTED,
} from '@agent-group-lab/contracts/messages';
import type { WorkState } from '@agent-group-lab/contracts/work';
import type { IProtocolEnvelope } from '@agent-group-lab/protocol';
import { nanoid } from 'nanoid';
import { createCommitmentRecord } from '~/domain/commitment';
import { createDelegationRecord } from '~/domain/delegation';
import { applyTaskClaim, type ITaskBoardEntry } from '~/domain/task-board';
import type { IHostStore } from '~/store/store';
import type { AgreementService } from './agreement-service';
import type { TaskBoardService } from './task-board-service';

interface ISessionExecutionServiceOptions {
	store: IHostStore;
	agreementService: AgreementService;
	taskBoardService: TaskBoardService;
	transitionWorkerState: (agentId: string, next: WorkState) => void;
	sendToConnection: (
		connectionId: string,
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => Promise<void>;
}

export interface IClaimAndAcceptInput {
	agentId: string;
	agentName: string;
	task: ITaskBoardEntry;
	assignmentToken: string;
	claimLeaseMs: number;
	claimLeaseExpiresAt: number;
	executionLeaseMs: number;
	at: number;
}

export class SessionExecutionService {
	private readonly options: ISessionExecutionServiceOptions;

	constructor(options: ISessionExecutionServiceOptions) {
		this.options = options;
	}

	claimAndAccept = async (input: IClaimAndAcceptInput) => {
		const claimedTask = applyTaskClaim({
			task: input.task,
			assigneeId: input.agentId,
			assigneeName: input.agentName,
			assignmentToken: input.assignmentToken,
			claimLeaseMs: input.claimLeaseMs,
			claimLeaseExpiresAt: input.claimLeaseExpiresAt,
			executionLeaseMs: input.executionLeaseMs,
			at: input.at,
		});
		this.options.store.setTaskBoardEntry(claimedTask);

		let delegationId: string | undefined;
		if (claimedTask.parentTaskId && claimedTask.requesterAgentId) {
			delegationId = nanoid();
			this.options.store.setDelegation(
				createDelegationRecord(
					{
						delegationId,
						delegatorId: claimedTask.requesterAgentId,
						delegateeId: input.agentId,
						originalTaskId: claimedTask.parentTaskId,
						delegatedTaskId: claimedTask.taskId,
					},
					input.at,
				),
			);
		}

		const commitment = createCommitmentRecord(
			{
				commitmentId: nanoid(),
				taskId: claimedTask.taskId,
				assigneeId: input.agentId,
				assigneeName: input.agentName,
				deliverableSpec: claimedTask.deliverableSpec,
				slaDeadline: claimedTask.slaDeadline,
				delegatedBy: claimedTask.requesterAgentId,
			},
			input.at,
		);
		this.options.store.setCommitment(commitment);

		const acceptedCommitment =
			this.options.agreementService.applyCommitmentTransition({
				commitment,
				nextStatus: 'accepted',
				at: input.at,
				eventContext: {
					actor: input.agentId,
					actorName: input.agentName,
					metadata: {
						taskId: commitment.taskId,
						assigneeId: commitment.assigneeId,
						delegatedBy: commitment.delegatedBy,
					},
				},
			});

		if (delegationId) {
			const delegation = this.options.store.getDelegation(delegationId);
			if (delegation) {
				this.options.agreementService.applyDelegationTransition({
					delegation,
					nextStatus: 'accepted',
					at: input.at,
					eventContext: {
						actor: input.agentId,
						actorName: input.agentName,
						metadata: {
							delegatorId: delegation.delegatorId,
							delegateeId: delegation.delegateeId,
							taskId: delegation.delegatedTaskId,
						},
					},
				});
			}
		}

		this.options.taskBoardService.markAssigned(claimedTask.taskId, input.at);
		this.options.taskBoardService.markDoing(claimedTask.taskId, input.at);
		this.options.transitionWorkerState(input.agentId, {
			kind: 'focused',
			taskId: claimedTask.taskId,
		});

		const acceptedPayload: ITaskAcceptedPayload = {
			taskId: claimedTask.taskId,
			agentId: input.agentId,
			agentName: input.agentName,
		};
		this.options
			.sendToConnection(claimedTask.requesterConnectionId, {
				type: TASK_ACCEPTED,
				channel: `task:${claimedTask.taskId}`,
				trace: {
					taskId: claimedTask.taskId,
					turnId: claimedTask.turnId,
				},
				payload: acceptedPayload,
			})
			.catch(() => {
				// requester 已断开时静默忽略，claim 结果不应回滚
			});

		return {
			task:
				this.options.store.getTaskBoardEntry(claimedTask.taskId) ?? claimedTask,
			commitment:
				this.options.store.getCommitment(acceptedCommitment.commitmentId) ??
				acceptedCommitment,
			delegationId,
		};
	};
}
