import {
	type ITaskPlanNodePayload,
	type ITaskPublishBatchPayload,
	type ITaskPublishBatchResultPayload,
	TASK_PUBLISH_BATCH_RESULT,
} from '@agent-group-lab/contracts/messages';
import type {
	IProtocolEnvelope,
	IProtocolErrorPayload,
} from '@agent-group-lab/protocol';
import {
	createTaskBoardEntry,
	type ITaskBoardEntry,
} from '~/domain/task-board';
import { selectWorkerForTask } from '~/policy/scheduler';
import type { IHostStore } from '~/store/store';
import type { IConnectionContext } from '../infra/connection-manager';
import type { TaskBoardService } from '../services/task-board-service';
import type { WorkQueueService } from '../services/work-queue-service';

interface ITaskPublishBatchHandlerOptions {
	store: IHostStore;
	taskClaimV2Enabled: boolean;
	taskBoardService: TaskBoardService;
	workQueueService: WorkQueueService;
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
	dispatchNextWorkForWorker: (agentId: string) => Promise<void>;
}

export class TaskPublishBatchHandler {
	private readonly options: ITaskPublishBatchHandlerOptions;

	constructor(options: ITaskPublishBatchHandlerOptions) {
		this.options = options;
	}

	handleTaskPublishBatch = async (
		context: IConnectionContext,
		parsed: ITaskPublishBatchPayload,
	) => {
		if (!this.options.taskClaimV2Enabled) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'task:publish-batch is disabled',
			);
			return;
		}

		const existing = this.options.taskBoardService.getTaskBoardMap();
		const drafts: ITaskBoardEntry[] = [];
		const rejected: Array<{
			taskId?: string;
			reasonCode: string;
			reason: string;
		}> = [];
		for (const node of parsed.nodes) {
			if (existing.has(node.taskId)) {
				rejected.push({
					taskId: node.taskId,
					reasonCode: 'task_conflict',
					reason: `Task ${node.taskId} already exists`,
				});
				continue;
			}
			const draft = this.createDraftEntry(node, context, existing);
			if ('reason' in draft) {
				rejected.push({
					taskId: node.taskId,
					reasonCode: draft.reasonCode ?? 'invalid_task_plan_node',
					reason: draft.reason ?? 'Invalid task plan node',
				});
				continue;
			}
			drafts.push(draft.entry);
			existing.set(draft.entry.taskId, draft.entry);
		}

		if (rejected.length > 0 && (parsed.atomic ?? true)) {
			await this.options.sendToConnection(context.meta.connectionId, {
				type: TASK_PUBLISH_BATCH_RESULT,
				channel: `task:${parsed.planId}`,
				payload: {
					planId: parsed.planId,
					status: 'rejected',
					acceptedTaskIds: [],
					rejected,
				} satisfies ITaskPublishBatchResultPayload,
			});
			return;
		}

		for (const task of drafts) {
			this.options.store.setTaskBoardEntry(task);
		}

		const sourceAgentId =
			context.meta.agentId ?? `connection:${context.meta.connectionId}`;
		const sourceAgentName = context.meta.agentId
			? this.options.store.getWorker(context.meta.agentId)?.agentName
			: undefined;
		for (const task of drafts) {
			if (!task.assigneeId || task.status !== 'todo') {
				continue;
			}
			this.options.workQueueService.ensureTaskWorkQueued(
				task,
				sourceAgentId,
				sourceAgentName,
			);
			await this.options.dispatchNextWorkForWorker(task.assigneeId);
		}

		await this.options.sendToConnection(context.meta.connectionId, {
			type: TASK_PUBLISH_BATCH_RESULT,
			channel: `task:${parsed.planId}`,
			payload: {
				planId: parsed.planId,
				status: rejected.length > 0 ? 'rejected' : 'accepted',
				acceptedTaskIds: drafts.map((item) => item.taskId),
				rejected: rejected.length > 0 ? rejected : undefined,
			} satisfies ITaskPublishBatchResultPayload,
		});
	};

	private createDraftEntry = (
		node: ITaskPlanNodePayload,
		context: IConnectionContext,
		existing: Map<string, ITaskBoardEntry>,
	) => {
		const dispatchMode = node.dispatchMode ?? 'push';
		let assigneeId: string | undefined;
		let assigneeRole: ITaskBoardEntry['assigneeRole'];
		if (dispatchMode === 'push') {
			const workerSelection = selectWorkerForTask({
				workers: this.options.store.listWorkers(),
				requestedAgentId: node.requestedAgentId,
				requiredRole:
					context.meta.connectionRole === 'worker' ? undefined : 'lead',
			});
			if (!workerSelection.worker) {
				return {
					reasonCode: 'no_worker_available',
					reason: workerSelection.error ?? 'No worker available',
				} as const;
			}
			assigneeId = workerSelection.worker.agentId;
			assigneeRole = workerSelection.worker.agentRole;
		}
		try {
			const entry = createTaskBoardEntry(
				{
					taskId: node.taskId,
					turnId: node.turnId,
					prompt: node.prompt,
					workingDirectory: node.workingDirectory,
					requesterConnectionId: context.meta.connectionId,
					requesterAgentId: context.meta.agentId,
					parentTaskId: node.parentTaskId,
					assigneeId,
					assigneeRole,
					dependencies: node.dependencies ?? [],
					deliverableSpec: node.deliverableSpec,
					slaDeadline: node.slaDeadline,
					dispatchMode,
					suggestedAgentIds: node.suggestedAgentIds,
					suggestionPolicy: node.suggestionPolicy,
				},
				{
					existingTasks: existing,
				},
			);
			return { entry } as const;
		} catch (error) {
			return {
				reasonCode: 'invalid_task_plan_node',
				reason:
					error instanceof Error ? error.message : 'Invalid task plan node',
			} as const;
		}
	};
}
