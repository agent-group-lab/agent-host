import { describe, expect, it, vi } from 'vitest';
import { createTaskBoardEntry } from '~/domain/task-board';
import { InMemoryStore } from '~/store/in-memory-store';
import { TaskListHandler } from './task-list-handler';

describe('TaskListHandler', () => {
	it('returns tasks by task ids with missingTaskIds', async () => {
		const store = new InMemoryStore();
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-1',
				turnId: 'turn-1',
				prompt: 'p1',
				workingDirectory: '/tmp',
				requesterConnectionId: 'conn-req',
			}),
		);
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-2',
				turnId: 'turn-2',
				prompt: 'p2',
				workingDirectory: '/tmp',
				requesterConnectionId: 'conn-req',
			}),
		);
		const sendToConnection = vi.fn(async () => {});
		const handler = new TaskListHandler({
			store,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection,
		});

		const context = {
			meta: {
				connectionId: 'conn-1',
				connectionRole: 'worker',
				ready: true,
				connectedAt: Date.now(),
			},
			live: {
				connection: {
					id: 'conn-1',
					send: vi.fn(async () => {}),
					close: vi.fn(async () => {}),
				},
			},
		};

		await handler.handleTaskList(context as never, {
			requestId: 'req-1',
			taskIds: ['task-2', 'task-missing', 'task-1'],
			includeArtifacts: true,
		});

		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-1',
			expect.objectContaining({
				type: 'task:list:result',
				payload: {
					requestId: 'req-1',
					tasks: [
						expect.objectContaining({ taskId: 'task-2' }),
						expect.objectContaining({ taskId: 'task-1' }),
					],
					missingTaskIds: ['task-missing'],
				},
			}),
		);
	});
});
