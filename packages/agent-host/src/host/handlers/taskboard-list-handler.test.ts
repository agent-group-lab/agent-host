import { describe, expect, it, vi } from 'vitest';
import { createTaskBoardEntry } from '~/domain/task-board';
import { InMemoryStore } from '~/store/in-memory-store';
import { TaskboardListHandler } from './taskboard-list-handler';

describe('TaskboardListHandler', () => {
	it('returns a paginated global taskboard view', async () => {
		const store = new InMemoryStore();
		store.setTaskBoardEntry(
			createTaskBoardEntry(
				{
					taskId: 'task-2',
					turnId: 'turn-2',
					prompt: 'task 2',
					requesterConnectionId: 'conn-req',
					dispatchMode: 'claim',
				},
				{ at: 200 },
			),
		);
		store.setTaskBoardEntry(
			createTaskBoardEntry(
				{
					taskId: 'task-1',
					turnId: 'turn-1',
					prompt: 'task 1',
					requesterConnectionId: 'conn-req',
					dispatchMode: 'claim',
				},
				{ at: 100 },
			),
		);
		store.setTaskBoardEntry({
			...createTaskBoardEntry(
				{
					taskId: 'task-3',
					turnId: 'turn-3',
					prompt: 'task 3',
					requesterConnectionId: 'conn-req',
					dispatchMode: 'claim',
				},
				{ at: 300 },
			),
			status: 'done',
			deliveredArtifact: { ok: true },
		});
		const sendToConnection = vi.fn(async () => {});
		const handler = new TaskboardListHandler({
			store,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection,
			log: vi.fn(),
		});

		const context = {
			meta: {
				connectionId: 'conn-1',
				connectionRole: 'client',
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

		await handler.handleTaskboardList(context as never, {
			limit: 2,
			includeArtifacts: true,
		});

		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-1',
			expect.objectContaining({
				type: 'taskboard:list:result',
				channel: 'control',
				payload: {
					tasks: [
						expect.objectContaining({
							taskId: 'task-1',
							createdAt: 100,
						}),
						expect.objectContaining({
							taskId: 'task-2',
							createdAt: 200,
						}),
					],
					nextCursor: {
						createdAt: 200,
						taskId: 'task-2',
					},
				},
			}),
		);
	});

	it('applies the after cursor strictly', async () => {
		const store = new InMemoryStore();
		store.setTaskBoardEntry(
			createTaskBoardEntry(
				{
					taskId: 'task-a',
					turnId: 'turn-a',
					prompt: 'task a',
					requesterConnectionId: 'conn-req',
				},
				{ at: 100 },
			),
		);
		store.setTaskBoardEntry(
			createTaskBoardEntry(
				{
					taskId: 'task-b',
					turnId: 'turn-b',
					prompt: 'task b',
					requesterConnectionId: 'conn-req',
				},
				{ at: 100 },
			),
		);
		store.setTaskBoardEntry(
			createTaskBoardEntry(
				{
					taskId: 'task-c',
					turnId: 'turn-c',
					prompt: 'task c',
					requesterConnectionId: 'conn-req',
				},
				{ at: 101 },
			),
		);
		const sendToConnection = vi.fn(async () => {});
		const handler = new TaskboardListHandler({
			store,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection,
			log: vi.fn(),
		});

		const context = {
			meta: {
				connectionId: 'conn-1',
				connectionRole: 'client',
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

		await handler.handleTaskboardList(context as never, {
			after: {
				createdAt: 100,
				taskId: 'task-a',
			},
			limit: 10,
		});

		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-1',
			expect.objectContaining({
				payload: {
					tasks: [
						expect.objectContaining({ taskId: 'task-b' }),
						expect.objectContaining({ taskId: 'task-c' }),
					],
					nextCursor: undefined,
				},
			}),
		);
	});
});
