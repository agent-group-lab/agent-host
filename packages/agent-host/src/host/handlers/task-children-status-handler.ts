import {
	type ITaskChildrenStatusPayload,
	type ITaskChildrenStatusResultPayload,
	TASK_CHILDREN_STATUS_RESULT,
} from '@agent-group-lab/contracts/messages';
import type {
	IProtocolEnvelope,
	IProtocolErrorPayload,
} from '@agent-group-lab/protocol';
import type { IHostStore } from '~/store/store';
import type { IConnectionContext } from '../infra/connection-manager';

interface ITaskChildrenStatusHandlerOptions {
	store: IHostStore;
	taskClaimV2Enabled: boolean;
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
	log: (message: string) => void;
}

type ITaskChildWithDepth = {
	item: ReturnType<IHostStore['getChildTasks']>[number];
	depth: number;
};

const DEFAULT_MAX_DEPTH = 20;
const MAX_ALLOWED_DEPTH = 100;

export class TaskChildrenStatusHandler {
	private readonly options: ITaskChildrenStatusHandlerOptions;

	constructor(options: ITaskChildrenStatusHandlerOptions) {
		this.options = options;
	}

	handleTaskChildrenStatus = async (
		context: IConnectionContext,
		parsed: ITaskChildrenStatusPayload,
	) => {
		if (!this.options.taskClaimV2Enabled) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'task:children:status is disabled',
			);
			return;
		}
		const maxDepth = Math.min(
			parsed.maxDepth ?? DEFAULT_MAX_DEPTH,
			MAX_ALLOWED_DEPTH,
		);
		const children = parsed.recursive
			? this.collectDescendants(parsed.parentTaskId, maxDepth)
			: this.options.store
					.getChildTasks(parsed.parentTaskId)
					.map((item) => ({ item, depth: 1 }));
		const done = children.filter(({ item }) => item.status === 'done').length;
		const cancelled = children.filter(
			({ item }) => item.status === 'cancelled',
		).length;
		const inProgress = children.filter(
			({ item }) => item.status === 'assigned' || item.status === 'doing',
		).length;
		const todo = children.filter(({ item }) => item.status === 'todo').length;
		const blocked = children.filter(
			({ item }) => item.status === 'blocked',
		).length;

		const result: ITaskChildrenStatusResultPayload = {
			requestId: parsed.requestId,
			parentTaskId: parsed.parentTaskId,
			recursive: parsed.recursive ?? false,
			summary: {
				total: children.length,
				done,
				cancelled,
				inProgress,
				todo,
				blocked,
			},
			allChildrenTerminal:
				children.every(
					({ item }) => item.status === 'done' || item.status === 'cancelled',
				) && children.length > 0,
			allChildrenDone:
				children.length > 0 &&
				children.every(({ item }) => item.status === 'done'),
			children: children.map(({ item, depth }) => ({
				taskId: item.taskId,
				parentTaskId: item.parentTaskId,
				depth,
				status: item.status,
				dependencies: item.dependencies,
				assigneeId: item.assigneeId,
				assigneeName: item.assigneeName,
				completedAt: item.completedAt,
				failureMessage: item.failureMessage,
				artifact: parsed.includeArtifacts ? item.deliveredArtifact : undefined,
			})),
		};
		await this.options.sendToConnection(context.meta.connectionId, {
			type: TASK_CHILDREN_STATUS_RESULT,
			channel: `task:${parsed.parentTaskId}`,
			payload: result,
		});
		const deepestDepth = children.reduce((max, child) => {
			return Math.max(max, child.depth);
		}, 0);
		this.options.log(
			`task:children:status returned ${children.length} tasks` +
				` (recursive=${parsed.recursive ?? false}, maxDepth=${maxDepth}, deepestDepth=${deepestDepth})`,
		);
	};

	private collectDescendants = (parentTaskId: string, maxDepth: number) => {
		const descendants: ITaskChildWithDepth[] = [];
		const queue = this.options.store
			.getChildTasks(parentTaskId)
			.map((item) => ({ item, depth: 1 }));

		while (queue.length > 0) {
			const current = queue.shift();
			if (!current) {
				continue;
			}
			descendants.push(current);
			if (current.depth >= maxDepth) {
				continue;
			}
			for (const child of this.options.store.getChildTasks(
				current.item.taskId,
			)) {
				queue.push({
					item: child,
					depth: current.depth + 1,
				});
			}
		}

		return descendants;
	};
}
