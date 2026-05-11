import {
	type ITaskClaimPullPayload,
	type ITaskClaimPullResultPayload,
	TASK_CLAIM_PULL_RESULT,
} from '@agent-group-lab/contracts/messages';
import type {
	IProtocolEnvelope,
	IProtocolErrorPayload,
} from '@agent-group-lab/protocol';
import { nanoid } from 'nanoid';
import { releaseTaskClaim } from '~/domain/task-board';
import type { WorkState } from '~/domain/work-state';
import type { IHostStore } from '~/store/store';
import type { IConnectionContext } from '../infra/connection-manager';
import type { SessionExecutionService } from '../services/session-execution-service';

interface ITaskClaimPullHandlerOptions {
	store: IHostStore;
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
	sessionExecutionService: SessionExecutionService;
}

const isActiveExecutionState = (workState: WorkState) => {
	return (
		workState.kind === 'focused' ||
		workState.kind === 'waiting_tool' ||
		workState.kind === 'waiting_delegation' ||
		workState.kind === 'waiting_peer' ||
		workState.kind === 'blocked'
	);
};

export class TaskClaimPullHandler {
	private readonly options: ITaskClaimPullHandlerOptions;

	constructor(options: ITaskClaimPullHandlerOptions) {
		this.options = options;
	}

	handleTaskClaimPull = async (
		context: IConnectionContext,
		parsed: ITaskClaimPullPayload,
	) => {
		if (context.meta.connectionRole !== 'worker' || !context.meta.agentId) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'Only worker can claim pull tasks',
			);
			return;
		}

		const worker = this.options.store.getWorker(context.meta.agentId);
		if (!worker) {
			await this.sendResult(context.meta.connectionId, {
				requestId: parsed.requestId,
				status: 'rejected',
				reasonCode: 'worker_busy',
				reason: 'worker not found',
			});
			return;
		}
		if (isActiveExecutionState(worker.workState)) {
			await this.sendResult(context.meta.connectionId, {
				requestId: parsed.requestId,
				status: 'rejected',
				reasonCode: 'worker_busy',
				reason: 'worker is already executing a task',
			});
			return;
		}

		const task = this.options.store.getTaskBoardEntry(parsed.taskId);
		if (!task) {
			await this.sendResult(context.meta.connectionId, {
				requestId: parsed.requestId,
				status: 'rejected',
				reasonCode: 'task_not_found',
				reason: `Task ${parsed.taskId} not found`,
			});
			return;
		}
		if (task.dispatchMode !== 'claim' || task.status !== 'todo') {
			await this.sendResult(context.meta.connectionId, {
				requestId: parsed.requestId,
				status: 'rejected',
				reasonCode: 'task_not_claimable',
				reason: `Task ${parsed.taskId} is not claimable`,
			});
			return;
		}

		const commitment = this.options.store.getCommitmentByTaskId(task.taskId);
		if (commitment?.status === 'accepted') {
			await this.sendResult(context.meta.connectionId, {
				requestId: parsed.requestId,
				status: 'rejected',
				reasonCode: 'commitment_exists',
				reason: 'Task already has an accepted commitment',
			});
			return;
		}

		const now = Date.now();
		const CLAIM_LOCK_MS = 10_000;
		const executionLeaseMs =
			parsed.executionLeaseMs ?? parsed.claimLeaseMs ?? 30_000;
		const activeClaim =
			task.assigneeId &&
			typeof task.claimLeaseExpiresAt === 'number' &&
			task.claimLeaseExpiresAt > now;
		if (activeClaim && task.assigneeId !== worker.agentId) {
			await this.sendResult(context.meta.connectionId, {
				requestId: parsed.requestId,
				status: 'rejected',
				reasonCode: 'already_claimed',
				reason: 'Task is currently claimed by another worker',
			});
			return;
		}

		const suggestionMismatch = this.getSuggestionMismatch(
			task,
			worker.agentId,
			now,
		);
		if (suggestionMismatch) {
			await this.sendResult(context.meta.connectionId, {
				requestId: parsed.requestId,
				status: 'rejected',
				reasonCode: 'suggestion_policy_mismatch',
				reason: suggestionMismatch,
			});
			return;
		}

		const nextTask =
			task.assigneeId &&
			typeof task.claimLeaseExpiresAt === 'number' &&
			task.claimLeaseExpiresAt <= now
				? releaseTaskClaim(task)
				: task;
		if (nextTask !== task) {
			this.options.store.setTaskBoardEntry(nextTask);
		}

		const claimLeaseExpiresAt = now + CLAIM_LOCK_MS;
		const assignmentToken = nanoid();
		const accepted = await this.options.sessionExecutionService.claimAndAccept({
			agentId: worker.agentId,
			agentName: worker.agentName,
			task: nextTask,
			assignmentToken,
			claimLeaseMs: CLAIM_LOCK_MS,
			claimLeaseExpiresAt,
			executionLeaseMs,
			at: now,
		});

		await this.sendResult(context.meta.connectionId, {
			requestId: parsed.requestId,
			status: 'claimed',
			taskId: accepted.task.taskId,
			assignmentToken,
			leaseExpiresAt: now + executionLeaseMs,
			task: {
				taskId: accepted.task.taskId,
				turnId: accepted.task.turnId,
				prompt: accepted.task.prompt,
				parentTaskId: accepted.task.parentTaskId,
				dependencies: accepted.task.dependencies,
				requesterAgentId: accepted.task.requesterAgentId,
			},
		});
	};

	private getSuggestionMismatch = (
		task: {
			suggestedAgentIds?: string[];
			suggestionPolicy?: 'strict' | 'preferred';
			createdAt: number;
		},
		agentId: string,
		now: number,
	) => {
		if (!task.suggestedAgentIds || task.suggestedAgentIds.length === 0) {
			return null;
		}
		if (task.suggestedAgentIds.includes(agentId)) {
			return null;
		}
		if (task.suggestionPolicy === 'strict') {
			return 'Worker is not in suggested agents';
		}
		if (task.suggestionPolicy !== 'preferred') {
			return null;
		}
		if (now >= task.createdAt + this.options.preferredHoldMs) {
			return null;
		}
		const hasOnlineSuggested = task.suggestedAgentIds.some(
			(suggestedAgentId) => {
				const worker = this.options.store.getWorker(suggestedAgentId);
				return worker && worker.workState.kind !== 'offline';
			},
		);
		if (!hasOnlineSuggested) {
			return null;
		}
		return 'Preferred worker window is still active';
	};

	private sendResult = async (
		connectionId: string,
		payload: ITaskClaimPullResultPayload,
	) => {
		await this.options.sendToConnection(connectionId, {
			type: TASK_CLAIM_PULL_RESULT,
			channel: `task:${payload.requestId}`,
			payload,
		});
	};
}
