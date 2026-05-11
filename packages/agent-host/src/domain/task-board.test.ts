import { describe, expect, it } from 'vitest';
import {
	createTaskBoardEntry,
	type ITaskBoardEntry,
	reassignTaskBoardEntry,
	resolveCompletedTask,
	transitionTaskBoard,
	transitionTaskBoardState,
	validateNoCycle,
} from './task-board';

const createTask = (
	overrides: Partial<ITaskBoardEntry> = {},
): ITaskBoardEntry => {
	return {
		taskId: overrides.taskId ?? 'task-1',
		turnId: overrides.turnId ?? 'turn-1',
		prompt: overrides.prompt ?? 'do work',
		workingDirectory: overrides.workingDirectory ?? '/tmp',
		requesterConnectionId: overrides.requesterConnectionId ?? 'conn-client',
		parentTaskId: overrides.parentTaskId,
		assigneeId: overrides.assigneeId,
		assigneeName: overrides.assigneeName,
		assigneeRole: overrides.assigneeRole,
		status: overrides.status ?? 'todo',
		dependencies: overrides.dependencies ?? [],
		deliverableSpec: overrides.deliverableSpec,
		slaDeadline: overrides.slaDeadline,
		createdAt: overrides.createdAt ?? 1,
		startedAt: overrides.startedAt,
		completedAt: overrides.completedAt,
		failureMessage: overrides.failureMessage,
		deliveredArtifact: overrides.deliveredArtifact,
	};
};

describe('task-board', () => {
	it('supports todo -> assigned -> doing -> done transitions', () => {
		const todo = createTask();
		const assigned = transitionTaskBoardState({
			task: todo,
			nextStatus: 'assigned',
		});
		expect(assigned.status).toBe('assigned');

		const doing = transitionTaskBoardState({
			task: assigned,
			nextStatus: 'doing',
			at: 10,
		});
		expect(doing.status).toBe('doing');
		expect(doing.startedAt).toBe(10);

		const done = transitionTaskBoardState({
			task: doing,
			nextStatus: 'done',
			at: 20,
			deliveredArtifact: { file: 'out.md' },
		});
		expect(done.status).toBe('done');
		expect(done.completedAt).toBe(20);
		expect(done.deliveredArtifact).toEqual({ file: 'out.md' });
	});

	it('supports todo -> blocked -> todo -> assigned -> doing -> done transitions', () => {
		const blocked = transitionTaskBoardState({
			task: createTask(),
			nextStatus: 'blocked',
		});
		expect(blocked.status).toBe('blocked');

		const todo = transitionTaskBoardState({
			task: blocked,
			nextStatus: 'todo',
		});
		expect(todo.status).toBe('todo');

		const assigned = transitionTaskBoardState({
			task: todo,
			nextStatus: 'assigned',
		});
		expect(assigned.status).toBe('assigned');

		const doing = transitionTaskBoardState({
			task: assigned,
			nextStatus: 'doing',
			at: 12,
		});
		expect(doing.status).toBe('doing');
		expect(doing.startedAt).toBe(12);

		const done = transitionTaskBoardState({
			task: doing,
			nextStatus: 'done',
			at: 13,
		});
		expect(done.status).toBe('done');
		expect(done.completedAt).toBe(13);
	});

	it('throws on invalid transition', () => {
		expect(() => {
			transitionTaskBoardState({
				task: createTask({ status: 'done' }),
				nextStatus: 'todo',
			});
		}).toThrowError('Invalid task-board status transition');
	});

	it('detects dependency cycles', () => {
		const board = new Map<string, ITaskBoardEntry>([
			['task-a', createTask({ taskId: 'task-a', dependencies: ['task-b'] })],
			['task-b', createTask({ taskId: 'task-b', dependencies: ['task-a'] })],
		]);

		expect(() => {
			validateNoCycle('task-c', ['task-a'], board);
		}).not.toThrow();

		expect(() => {
			validateNoCycle('task-a', ['task-b'], board);
		}).toThrowError('would create a cycle');
	});

	it('does not false-positive on diamond dependency graph', () => {
		const board = new Map<string, ITaskBoardEntry>([
			['task-b', createTask({ taskId: 'task-b', dependencies: ['task-d'] })],
			['task-c', createTask({ taskId: 'task-c', dependencies: ['task-d'] })],
			['task-d', createTask({ taskId: 'task-d', dependencies: [] })],
		]);

		expect(() => {
			validateNoCycle('task-a', ['task-b', 'task-c'], board);
		}).not.toThrow();
	});

	it('unlocks blocked task when dependency completes', () => {
		const board = new Map<string, ITaskBoardEntry>();
		board.set('task-a', createTask({ taskId: 'task-a', status: 'done' }));
		board.set(
			'task-b',
			createTask({
				taskId: 'task-b',
				status: 'blocked',
				dependencies: ['task-a'],
			}),
		);

		const unlocked = resolveCompletedTask({
			completedTaskId: 'task-a',
			taskBoard: board,
			at: 10,
		});
		expect(unlocked).toEqual(['task-b']);
		expect(board.get('task-b')?.status).toBe('todo');
	});

	it('keeps blocked when only part of dependencies are done', () => {
		const board = new Map<string, ITaskBoardEntry>();
		board.set('task-a', createTask({ taskId: 'task-a', status: 'done' }));
		board.set('task-c', createTask({ taskId: 'task-c', status: 'todo' }));
		board.set(
			'task-b',
			createTask({
				taskId: 'task-b',
				status: 'blocked',
				dependencies: ['task-a', 'task-c'],
			}),
		);

		const unlocked = resolveCompletedTask({
			completedTaskId: 'task-a',
			taskBoard: board,
		});
		expect(unlocked).toEqual([]);
		expect(board.get('task-b')?.status).toBe('blocked');
	});

	it('creates blocked task when dependencies are unresolved', () => {
		const board = new Map<string, ITaskBoardEntry>();
		board.set('task-a', createTask({ taskId: 'task-a', status: 'todo' }));

		const created = createTaskBoardEntry(
			{
				taskId: 'task-b',
				turnId: 'turn-b',
				prompt: 'needs task-a',
				workingDirectory: '/tmp',
				requesterConnectionId: 'conn',
				dependencies: ['task-a'],
			},
			{ existingTasks: board, at: 100 },
		);
		expect(created.status).toBe('blocked');
		expect(created.createdAt).toBe(100);
	});

	it('reassigns non-terminal task-board entry to todo', () => {
		const doing = createTask({
			taskId: 'task-r',
			status: 'doing',
			assigneeId: 'agent-a',
			startedAt: 10,
			deliveredArtifact: { stale: true },
		});
		const reassigned = reassignTaskBoardEntry({
			task: doing,
			assigneeId: 'agent-b',
			assigneeName: undefined,
		});
		expect(reassigned.assigneeId).toBe('agent-b');
		expect(reassigned.status).toBe('todo');
		expect(reassigned.startedAt).toBeUndefined();
		expect(reassigned.completedAt).toBeUndefined();
		expect(reassigned.failureMessage).toBeUndefined();
		expect(reassigned.deliveredArtifact).toBeUndefined();
	});

	it('rejects reassigning terminal task-board entry', () => {
		expect(() => {
			reassignTaskBoardEntry({
				task: createTask({ taskId: 'task-done', status: 'done' }),
				assigneeId: 'agent-b',
				assigneeName: undefined,
			});
		}).toThrowError('Cannot reassign terminal task-board entry');
	});

	it('produces transition events via new transition api', () => {
		const assigned = transitionTaskBoard({
			task: createTask({ taskId: 'task-evt', status: 'assigned' }),
			nextStatus: 'doing',
			at: 10,
		});

		expect(assigned.domainEvents.map((event) => event.eventType)).toEqual([
			'task:status_changed',
			'task:started',
		]);
	});
});
