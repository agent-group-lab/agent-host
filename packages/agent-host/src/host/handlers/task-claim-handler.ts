import {
	type ITaskClaimPayload,
	type ITaskClaimResultPayload,
	TASK_CLAIM_RESULT,
} from '@agent-group-lab/contracts/messages';
import type {
	IProtocolEnvelope,
	IProtocolErrorPayload,
} from '@agent-group-lab/protocol';
import { nanoid } from 'nanoid';
import { createDelegationRecord } from '~/domain/delegation';
import {
	applyTaskClaim,
	type ITaskBoardEntry,
	releaseTaskClaim,
} from '~/domain/task-board';
import type { IHostStore } from '~/store/store';
import type { IConnectionContext } from '../infra/connection-manager';
import type { WorkQueueService } from '../services/work-queue-service';

interface ITaskClaimHandlerOptions {
	store: IHostStore;
	taskClaimV2Enabled: boolean;
	preferredHoldMs: number;
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
	workQueueService: WorkQueueService;
	dispatchNextWorkForWorker: (agentId: string) => Promise<void>;
}

export class TaskClaimHandler {
	private readonly options: ITaskClaimHandlerOptions;

	constructor(options: ITaskClaimHandlerOptions) {
		this.options = options;
	}

	handleTaskClaim = async (
		context: IConnectionContext,
		parsed: ITaskClaimPayload,
	) => {
		if (!this.options.taskClaimV2Enabled) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'task:claim is disabled',
			);
			return;
		}
		if (context.meta.connectionRole !== 'worker' || !context.meta.agentId) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'Only worker can claim tasks',
			);
			return;
		}

		const worker = this.options.store.getWorker(context.meta.agentId);
		if (!worker) {
			await this.sendResult(context.meta.connectionId, {
				requestId: parsed.requestId,
				status: 'rejected',
				reasonCode: 'unauthorized',
				reason: 'worker not found',
			});
			return;
		}
		if (worker.workState.kind !== 'idle') {
			await this.sendResult(context.meta.connectionId, {
				requestId: parsed.requestId,
				status: 'rejected',
				reasonCode: 'worker_not_idle',
				reason: 'worker is not idle',
			});
			return;
		}

		const now = Date.now();
		const claimLeaseMs = parsed.claimLeaseMs ?? 30_000;
		const candidate = this.pickCandidate({
			agentId: worker.agentId,
			taskId: parsed.selector?.taskId,
			parentTaskId: parsed.selector?.parentTaskId,
			now,
		});
		if (!candidate) {
			await this.sendResult(context.meta.connectionId, {
				requestId: parsed.requestId,
				status: 'none',
				reasonCode: 'no_matching_claimable_task',
				reason: 'No claimable task found',
			});
			return;
		}
		if ('reasonCode' in candidate) {
			await this.sendResult(context.meta.connectionId, {
				requestId: parsed.requestId,
				status: 'none',
				reasonCode: candidate.reasonCode,
				reason: candidate.reason,
			});
			return;
		}

		const executionLeaseMs = parsed.executionLeaseMs ?? claimLeaseMs;
		const assignmentToken = nanoid();
		const leaseExpiresAt = now + claimLeaseMs;
		let claimedTask: ITaskBoardEntry = applyTaskClaim({
			task: candidate,
			assigneeId: worker.agentId,
			assigneeName: worker.agentName,
			assignmentToken,
			claimLeaseMs,
			claimLeaseExpiresAt: leaseExpiresAt,
			executionLeaseMs,
			at: now,
		});
		this.options.store.setTaskBoardEntry(claimedTask);
		let createdDelegationId: string | undefined;
		if (claimedTask.parentTaskId && claimedTask.requesterAgentId) {
			createdDelegationId = nanoid();
			this.options.store.setDelegation(
				createDelegationRecord({
					delegationId: createdDelegationId,
					delegatorId: claimedTask.requesterAgentId,
					delegateeId: worker.agentId,
					originalTaskId: claimedTask.parentTaskId,
					delegatedTaskId: claimedTask.taskId,
				}),
			);
		}

		// Important ordering: claim result must be observed before task:assign.
		await this.sendResult(context.meta.connectionId, {
			requestId: parsed.requestId,
			status: 'claimed',
			taskId: claimedTask.taskId,
			assignmentToken,
			leaseExpiresAt,
		});

		try {
			this.options.workQueueService.ensureTaskWorkQueued(
				claimedTask,
				worker.agentId,
				worker.agentName,
			);
			await this.options.dispatchNextWorkForWorker(worker.agentId);
		} catch (error) {
			claimedTask = releaseTaskClaim(claimedTask);
			this.options.store.setTaskBoardEntry(claimedTask);
			if (createdDelegationId) {
				this.options.store.deleteDelegation(createdDelegationId);
			}
			await this.options.sendProtocolError(
				context.live.connection,
				'retryable',
				error instanceof Error ? error.message : 'Failed to dispatch',
				{
					requestId: parsed.requestId,
					taskId: claimedTask.taskId,
					reasonCode: 'dispatch_failed',
				},
			);
			return;
		}
	};

	private sendResult = async (
		connectionId: string,
		payload: ITaskClaimResultPayload,
	) => {
		await this.options.sendToConnection(connectionId, {
			type: TASK_CLAIM_RESULT,
			channel: `task:${payload.requestId}`,
			payload,
		});
	};

	private pickCandidate = (input: {
		agentId: string;
		taskId?: string;
		parentTaskId?: string;
		now: number;
	}) => {
		let entries = this.options.store.getTaskBoardEntries({ status: 'todo' });
		entries = entries.filter((entry) => entry.dispatchMode === 'claim');
		if (input.taskId) {
			entries = entries.filter((entry) => entry.taskId === input.taskId);
		}
		if (input.parentTaskId) {
			entries = entries.filter(
				(entry) => entry.parentTaskId === input.parentTaskId,
			);
		}
		for (const entry of entries) {
			const commitment = this.options.store.getCommitmentByTaskId(entry.taskId);
			if (commitment && commitment.status === 'accepted') {
				continue;
			}
			const leaseActive =
				typeof entry.claimLeaseExpiresAt === 'number' &&
				entry.claimLeaseExpiresAt > input.now &&
				entry.assigneeId;
			if (leaseActive && entry.assigneeId !== input.agentId) {
				continue;
			}
			if (entry.suggestedAgentIds && entry.suggestedAgentIds.length > 0) {
				if (entry.suggestionPolicy === 'strict') {
					if (!entry.suggestedAgentIds.includes(input.agentId)) {
						return {
							reasonCode: 'suggested_agent_mismatch',
							reason: 'Worker is not in suggested agents',
						} as const;
					}
				}
				if (entry.suggestionPolicy === 'preferred') {
					const preferredStillActive =
						input.now < entry.createdAt + this.options.preferredHoldMs;
					if (
						preferredStillActive &&
						!entry.suggestedAgentIds.includes(input.agentId)
					) {
						const hasOnlineSuggested = entry.suggestedAgentIds.some(
							(agentId) => {
								const worker = this.options.store.getWorker(agentId);
								return worker && worker.workState.kind !== 'offline';
							},
						);
						if (hasOnlineSuggested) {
							return {
								reasonCode: 'preferred_window_active',
								reason: 'Preferred worker window is still active',
							} as const;
						}
					}
				}
			}
			return leaseActive ? releaseTaskClaim(entry) : entry;
		}
		return null;
	};
}
