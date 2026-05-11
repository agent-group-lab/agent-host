import { describe, expect, it, vi } from 'vitest';
import { createTaskBoardEntry } from '~/domain/task-board';
import { InMemoryStore } from '~/store/in-memory-store';
import { TaskChildrenStatusHandler } from './task-children-status-handler';

describe('TaskChildrenStatusHandler', () => {
	it('returns allChildrenTerminal=false when no children exist', async () => {
		const store = new InMemoryStore();
		const sendToConnection = vi.fn(async () => {});
		const handler = new TaskChildrenStatusHandler({
			store,
			taskClaimV2Enabled: true,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection,
			log: vi.fn(),
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

		await handler.handleTaskChildrenStatus(context as never, {
			requestId: 'req-1',
			parentTaskId: 'task-parent',
			maxDepth: 20,
		});

		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-1',
			expect.objectContaining({
				type: 'task:children:status:result',
				payload: expect.objectContaining({
					allChildrenTerminal: false,
					allChildrenDone: false,
				}),
			}),
		);
	});

	it('returns recursive descendant convergence summary', async () => {
		const store = new InMemoryStore();
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-parent',
				turnId: 'turn-parent',
				prompt: 'parent',
				requesterConnectionId: 'conn-req',
			}),
		);
		store.setTaskBoardEntry({
			...createTaskBoardEntry({
				taskId: 'task-child-1',
				turnId: 'turn-child-1',
				prompt: 'child 1',
				requesterConnectionId: 'conn-req',
				parentTaskId: 'task-parent',
			}),
			status: 'done',
			completedAt: 111,
		});
		store.setTaskBoardEntry({
			...createTaskBoardEntry({
				taskId: 'task-child-2',
				turnId: 'turn-child-2',
				prompt: 'child 2',
				requesterConnectionId: 'conn-req',
				parentTaskId: 'task-parent',
				dependencies: ['task-child-1'],
			}),
			status: 'doing',
		});
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-grandchild-1',
				turnId: 'turn-grandchild-1',
				prompt: 'grandchild 1',
				requesterConnectionId: 'conn-req',
				parentTaskId: 'task-child-2',
			}),
		);
		const sendToConnection = vi.fn(async () => {});
		const handler = new TaskChildrenStatusHandler({
			store,
			taskClaimV2Enabled: true,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection,
			log: vi.fn(),
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

		await handler.handleTaskChildrenStatus(context as never, {
			requestId: 'req-2',
			parentTaskId: 'task-parent',
			recursive: true,
			maxDepth: 20,
			includeArtifacts: false,
		});

		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-1',
			expect.objectContaining({
				type: 'task:children:status:result',
				payload: {
					requestId: 'req-2',
					parentTaskId: 'task-parent',
					recursive: true,
					summary: {
						total: 3,
						done: 1,
						cancelled: 0,
						inProgress: 1,
						todo: 1,
						blocked: 0,
					},
					allChildrenTerminal: false,
					allChildrenDone: false,
					children: [
						{
							taskId: 'task-child-1',
							parentTaskId: 'task-parent',
							depth: 1,
							status: 'done',
							dependencies: [],
							assigneeId: undefined,
							assigneeName: undefined,
							completedAt: 111,
							failureMessage: undefined,
							artifact: undefined,
						},
						{
							taskId: 'task-child-2',
							parentTaskId: 'task-parent',
							depth: 1,
							status: 'doing',
							dependencies: ['task-child-1'],
							assigneeId: undefined,
							assigneeName: undefined,
							completedAt: undefined,
							failureMessage: undefined,
							artifact: undefined,
						},
						{
							taskId: 'task-grandchild-1',
							parentTaskId: 'task-child-2',
							depth: 2,
							status: 'todo',
							dependencies: [],
							assigneeId: undefined,
							assigneeName: undefined,
							completedAt: undefined,
							failureMessage: undefined,
							artifact: undefined,
						},
					],
				},
			}),
		);
	});

	it('caps recursive traversal by maxDepth', async () => {
		const store = new InMemoryStore();
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-parent',
				turnId: 'turn-parent',
				prompt: 'parent',
				requesterConnectionId: 'conn-req',
			}),
		);
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-child',
				turnId: 'turn-child',
				prompt: 'child',
				requesterConnectionId: 'conn-req',
				parentTaskId: 'task-parent',
			}),
		);
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-grandchild',
				turnId: 'turn-grandchild',
				prompt: 'grandchild',
				requesterConnectionId: 'conn-req',
				parentTaskId: 'task-child',
			}),
		);
		const sendToConnection = vi.fn(async () => {});
		const handler = new TaskChildrenStatusHandler({
			store,
			taskClaimV2Enabled: true,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection,
			log: vi.fn(),
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

		await handler.handleTaskChildrenStatus(context as never, {
			requestId: 'req-3',
			parentTaskId: 'task-parent',
			recursive: true,
			maxDepth: 1,
		});

		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-1',
			expect.objectContaining({
				payload: expect.objectContaining({
					children: [
						expect.objectContaining({ taskId: 'task-child', depth: 1 }),
					],
					summary: expect.objectContaining({ total: 1 }),
				}),
			}),
		);
	});
});
