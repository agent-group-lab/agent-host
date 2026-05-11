import {
	type ITaskboardListItem,
	type ITaskboardListPayload,
	type ITaskboardListResultPayload,
	TASKBOARD_LIST_RESULT,
} from '@agent-group-lab/contracts/messages';
import type {
	IProtocolEnvelope,
	IProtocolErrorPayload,
} from '@agent-group-lab/protocol';
import type { ITaskBoardEntry } from '~/domain/task-board';
import type { IHostStore } from '~/store/store';
import type { IConnectionContext } from '../infra/connection-manager';

interface ITaskboardListHandlerOptions {
	store: IHostStore;
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

const compareTaskboardEntryCursor = (
	left: Pick<ITaskBoardEntry, 'createdAt' | 'taskId'>,
	right: Pick<ITaskBoardEntry, 'createdAt' | 'taskId'>,
) => {
	if (left.createdAt !== right.createdAt) {
		return left.createdAt - right.createdAt;
	}
	return left.taskId.localeCompare(right.taskId);
};

export class TaskboardListHandler {
	private readonly options: ITaskboardListHandlerOptions;

	constructor(options: ITaskboardListHandlerOptions) {
		this.options = options;
	}

	handleTaskboardList = async (
		context: IConnectionContext,
		parsed: ITaskboardListPayload,
	) => {
		const limit = parsed.limit ?? 50;
		const cursor = parsed.after;
		const entries = this.options.store.getTaskBoardEntries();
		const filteredEntries = !cursor
			? entries
			: entries.filter((entry) => {
					return compareTaskboardEntryCursor(entry, cursor) > 0;
				});
		const pageEntries = filteredEntries.slice(0, limit + 1);
		const hasNext = pageEntries.length > limit;
		const tasks = pageEntries
			.slice(0, limit)
			.map((entry) => this.toTaskboardListItem(entry, parsed.includeArtifacts));
		const lastTask = tasks.at(-1);

		const result: ITaskboardListResultPayload = {
			tasks,
			nextCursor:
				hasNext && lastTask
					? {
							createdAt: lastTask.createdAt,
							taskId: lastTask.taskId,
						}
					: undefined,
		};

		await this.options.sendToConnection(context.meta.connectionId, {
			type: TASKBOARD_LIST_RESULT,
			channel: 'control',
			payload: result,
		});
		this.options.log(
			`taskboard:list room view returned ${tasks.length} tasks` +
				` (hasNext=${hasNext}, includeArtifacts=${parsed.includeArtifacts === true})`,
		);
	};

	private toTaskboardListItem = (
		entry: ITaskBoardEntry,
		includeArtifacts: boolean | undefined,
	): ITaskboardListItem => {
		return {
			taskId: entry.taskId,
			turnId: entry.turnId,
			prompt: entry.prompt,
			status: entry.status,
			workingDirectory: entry.workingDirectory,
			parentTaskId: entry.parentTaskId,
			dependencies: entry.dependencies,
			assigneeId: entry.assigneeId,
			assigneeName: entry.assigneeName,
			deliverableSpec: entry.deliverableSpec,
			dispatchMode: entry.dispatchMode,
			suggestedAgentIds: entry.suggestedAgentIds,
			suggestionPolicy: entry.suggestionPolicy,
			createdAt: entry.createdAt,
			completedAt: entry.completedAt,
			failureMessage: entry.failureMessage,
			claimLeaseExpiresAt: entry.claimLeaseExpiresAt,
			claimedAt: entry.claimedAt,
			artifact: includeArtifacts ? entry.deliveredArtifact : undefined,
		};
	};
}
