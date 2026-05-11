import {
	type ITaskListPayload,
	type ITaskListResultPayload,
	TASK_LIST_RESULT,
} from '@agent-group-lab/contracts/messages';
import type {
	IProtocolEnvelope,
	IProtocolErrorPayload,
} from '@agent-group-lab/protocol';
import type { IHostStore } from '~/store/store';
import type { IConnectionContext } from '../infra/connection-manager';

interface ITaskListHandlerOptions {
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
}

export class TaskListHandler {
	private readonly options: ITaskListHandlerOptions;

	constructor(options: ITaskListHandlerOptions) {
		this.options = options;
	}

	handleTaskList = async (
		context: IConnectionContext,
		parsed: ITaskListPayload,
	) => {
		if (!Array.isArray(parsed.taskIds) || parsed.taskIds.length === 0) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'task:list requires non-empty taskIds',
			);
			return;
		}

		const includeArtifacts = parsed.includeArtifacts ?? false;
		const requestedTaskIds = [
			...new Set(
				parsed.taskIds
					.map((taskId) => taskId.trim())
					.filter((taskId) => taskId.length > 0),
			),
		];
		const tasks = requestedTaskIds
			.map((taskId) => this.options.store.getTaskBoardEntry(taskId))
			.filter((task): task is NonNullable<typeof task> => task !== undefined)
			.map((task) => ({
				taskId: task.taskId,
				status: task.status,
				parentTaskId: task.parentTaskId,
				assigneeId: task.assigneeId,
				assigneeName: task.assigneeName,
				completedAt: task.completedAt,
				failureMessage: task.failureMessage,
				artifact: includeArtifacts ? task.deliveredArtifact : undefined,
			}));
		const foundIds = new Set(tasks.map((task) => task.taskId));
		const missingTaskIds = requestedTaskIds.filter(
			(taskId) => !foundIds.has(taskId),
		);
		const result: ITaskListResultPayload = {
			requestId: parsed.requestId,
			tasks,
			missingTaskIds,
		};
		await this.options.sendToConnection(context.meta.connectionId, {
			type: TASK_LIST_RESULT,
			channel: `task:${parsed.requestId}`,
			payload: result,
		});
	};
}
