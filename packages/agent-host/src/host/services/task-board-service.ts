import type { ITransitionEvent } from '@agent-group-lab/contracts/events';
import {
	type ITaskBoardEntry,
	reassignTaskBoardEntry,
	requeueTask,
	resolveCompletedTask,
	transitionTaskBoard,
} from '~/domain/task-board';
import type { IHostStore } from '~/store/store';

interface ITaskBoardServiceOptions {
	store: IHostStore;
	onTransitionEvents: (events: ITransitionEvent[]) => void;
}

export class TaskBoardService {
	private readonly options: ITaskBoardServiceOptions;

	constructor(options: ITaskBoardServiceOptions) {
		this.options = options;
	}

	getTaskBoardMap = () => {
		const map = new Map<string, ITaskBoardEntry>();
		for (const entry of this.options.store.getTaskBoardEntries()) {
			map.set(entry.taskId, entry);
		}
		return map;
	};

	markDoing = (taskId: string, at?: number) => {
		const taskBoard = this.options.store.getTaskBoardEntry(taskId);
		if (!taskBoard) {
			return;
		}
		if (taskBoard.status === 'doing') {
			return;
		}
		if (taskBoard.status === 'todo' || taskBoard.status === 'assigned') {
			const result = transitionTaskBoard({
				task: taskBoard,
				nextStatus: 'doing',
				at,
				eventContext: {
					actor: taskBoard.assigneeId ?? 'host',
					actorName: taskBoard.assigneeName,
					metadata: {
						assigneeId: taskBoard.assigneeId,
						parentTaskId: taskBoard.parentTaskId,
					},
				},
			});
			this.options.store.setTaskBoardEntry(result.state);
			this.options.onTransitionEvents(result.domainEvents);
		}
	};

	markAssigned = (taskId: string, at?: number) => {
		const taskBoard = this.options.store.getTaskBoardEntry(taskId);
		if (!taskBoard) {
			return;
		}
		if (taskBoard.status === 'assigned') {
			return;
		}
		if (taskBoard.status === 'todo') {
			const result = transitionTaskBoard({
				task: taskBoard,
				nextStatus: 'assigned',
				at,
				eventContext: {
					actor: taskBoard.assigneeId ?? 'host',
					actorName: taskBoard.assigneeName,
					metadata: {
						assigneeId: taskBoard.assigneeId,
						parentTaskId: taskBoard.parentTaskId,
					},
				},
			});
			this.options.store.setTaskBoardEntry(result.state);
			this.options.onTransitionEvents(result.domainEvents);
		}
	};

	/**
	 * Transitions the task to done and returns unlocked task IDs.
	 * Callers are responsible for queueing and dispatching unlocked tasks.
	 */
	markDone = (taskId: string, artifact?: unknown, at?: number): string[] => {
		const taskBoard = this.options.store.getTaskBoardEntry(taskId);
		if (!taskBoard) {
			return [];
		}
		if (taskBoard.status === 'done') {
			return [];
		}
		if (
			taskBoard.status !== 'doing' &&
			!(taskBoard.status === 'todo' && taskBoard.lastAssignmentToken)
		) {
			return [];
		}

		const result = transitionTaskBoard({
			task: taskBoard,
			nextStatus: 'done',
			deliveredArtifact: artifact,
			at,
			eventContext: {
				actor: taskBoard.assigneeId ?? 'host',
				actorName: taskBoard.assigneeName,
				metadata: {
					assigneeId: taskBoard.assigneeId,
					parentTaskId: taskBoard.parentTaskId,
				},
			},
		});
		this.options.store.setTaskBoardEntry(result.state);
		this.options.onTransitionEvents(result.domainEvents);

		const taskBoardMap = this.getTaskBoardMap();
		const unlockedTaskIds = resolveCompletedTask({
			completedTaskId: taskId,
			taskBoard: taskBoardMap,
			at,
		});
		for (const unlockedTaskId of unlockedTaskIds) {
			const unlockedTask = taskBoardMap.get(unlockedTaskId);
			if (unlockedTask) {
				this.options.store.setTaskBoardEntry(unlockedTask);
			}
		}
		return unlockedTaskIds;
	};

	markCancelled = (taskId: string, failureMessage?: string, at?: number) => {
		const taskBoard = this.options.store.getTaskBoardEntry(taskId);
		if (!taskBoard) {
			return;
		}
		if (taskBoard.status === 'cancelled') {
			return;
		}
		if (
			taskBoard.status === 'todo' ||
			taskBoard.status === 'assigned' ||
			taskBoard.status === 'doing' ||
			taskBoard.status === 'blocked'
		) {
			const result = transitionTaskBoard({
				task: taskBoard,
				nextStatus: 'cancelled',
				failureMessage,
				at,
				eventContext: {
					actor: taskBoard.assigneeId ?? 'host',
					actorName: taskBoard.assigneeName,
					metadata: {
						assigneeId: taskBoard.assigneeId,
						parentTaskId: taskBoard.parentTaskId,
					},
				},
			});
			this.options.store.setTaskBoardEntry(result.state);
			this.options.onTransitionEvents(result.domainEvents);
		}
	};

	markRequeued = (taskId: string, at?: number) => {
		const taskBoard = this.options.store.getTaskBoardEntry(taskId);
		if (!taskBoard || taskBoard.status !== 'doing') {
			return;
		}
		const requeued = requeueTask(taskBoard);
		const result = transitionTaskBoard({
			task: taskBoard,
			nextStatus: 'todo',
			at,
			eventContext: {
				actor: taskBoard.assigneeId ?? 'host',
				actorName: taskBoard.assigneeName,
				metadata: {
					assigneeId: taskBoard.assigneeId,
					parentTaskId: taskBoard.parentTaskId,
					claimAttempt: requeued.claimAttempt,
				},
			},
		});
		this.options.store.setTaskBoardEntry({
			...result.state,
			assigneeId: requeued.assigneeId,
			assigneeName: requeued.assigneeName,
			lastAssignmentToken: requeued.lastAssignmentToken,
			assignmentToken: requeued.assignmentToken,
			claimLeaseExpiresAt: requeued.claimLeaseExpiresAt,
			executionLeaseExpiresAt: requeued.executionLeaseExpiresAt,
			claimedAt: requeued.claimedAt,
			startedAt: requeued.startedAt,
			claimAttempt: requeued.claimAttempt,
		});
		this.options.onTransitionEvents(result.domainEvents);
	};

	reassign = (
		taskId: string,
		assigneeId: string,
		assigneeName: string | undefined,
	) => {
		const taskBoard = this.options.store.getTaskBoardEntry(taskId);
		if (!taskBoard) {
			return;
		}
		this.options.store.setTaskBoardEntry(
			reassignTaskBoardEntry({
				task: taskBoard,
				assigneeId,
				assigneeName,
			}),
		);
	};
}
