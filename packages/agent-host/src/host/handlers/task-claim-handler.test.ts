import { describe, expect, it, vi } from 'vitest';
import { createTaskBoardEntry } from '~/domain/task-board';
import { InMemoryStore } from '~/store/in-memory-store';
import { TaskClaimHandler } from './task-claim-handler';

const createWorkerContext = (agentId: string) => {
	return {
		meta: {
			connectionId: `conn-${agentId}`,
			connectionRole: 'worker',
			agentId,
			ready: true,
			connectedAt: Date.now(),
		},
		live: {
			connection: {
				id: `conn-${agentId}`,
				send: vi.fn(async () => {}),
				close: vi.fn(async () => {}),
			},
		},
	} as const;
};

describe('TaskClaimHandler', () => {
	it('sends claimed result before dispatching work', async () => {
		const store = new InMemoryStore();
		store.setWorker({
			agentId: 'exec-1',
			agentName: 'exec-1',
			connectionId: 'conn-exec-1',
			workerType: 'persistent',
			adapterId: 'codex',
			capabilities: {
				streaming: true,
				toolUse: true,
				codeExecution: true,
				fileRead: true,
				fileWrite: true,
			},
			agentRole: 'executor',
			workState: { kind: 'idle' },
			lastSeenAt: Date.now(),
		});
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-1',
				turnId: 'turn-1',
				prompt: 'work',
				workingDirectory: '/tmp',
				requesterConnectionId: 'conn-lead',
				dispatchMode: 'claim',
			}),
		);

		const order: string[] = [];
		const handler = new TaskClaimHandler({
			store,
			taskClaimV2Enabled: true,
			preferredHoldMs: 5_000,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection: vi.fn(async (_connectionId, message) => {
				if (message.type === 'task:claim:result') {
					order.push('result');
				}
			}),
			workQueueService: {
				ensureTaskWorkQueued: vi.fn(() => {
					order.push('queue');
				}),
				dropInboxEntriesForWorker: vi.fn(),
				completeTaskWork: vi.fn(),
			} as never,
			dispatchNextWorkForWorker: vi.fn(async () => {
				order.push('dispatch');
			}),
		});

		await handler.handleTaskClaim(createWorkerContext('exec-1') as never, {
			requestId: 'req-1',
		});

		expect(order).toEqual(['result', 'queue', 'dispatch']);
	});

	it('rolls back task claim and delegation when dispatch fails', async () => {
		const store = new InMemoryStore();
		store.setWorker({
			agentId: 'exec-1',
			agentName: 'exec-1',
			connectionId: 'conn-exec-1',
			workerType: 'persistent',
			adapterId: 'codex',
			capabilities: {
				streaming: true,
				toolUse: true,
				codeExecution: true,
				fileRead: true,
				fileWrite: true,
			},
			agentRole: 'executor',
			workState: { kind: 'idle' },
			lastSeenAt: Date.now(),
		});
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-child',
				turnId: 'turn-1',
				prompt: 'child work',
				workingDirectory: '/tmp',
				requesterConnectionId: 'conn-lead',
				requesterAgentId: 'lead',
				parentTaskId: 'task-parent',
				dispatchMode: 'claim',
			}),
		);

		const sendProtocolError = vi.fn(async () => {});
		const handler = new TaskClaimHandler({
			store,
			taskClaimV2Enabled: true,
			preferredHoldMs: 5_000,
			sendProtocolError,
			sendToConnection: vi.fn(async () => {}),
			workQueueService: {
				ensureTaskWorkQueued: vi.fn(),
				dropInboxEntriesForWorker: vi.fn(),
				completeTaskWork: vi.fn(),
			} as never,
			dispatchNextWorkForWorker: vi.fn(async () => {
				throw new Error('dispatch boom');
			}),
		});

		await handler.handleTaskClaim(createWorkerContext('exec-1') as never, {
			requestId: 'req-1',
		});

		const task = store.getTaskBoardEntry('task-child');
		expect(task?.assigneeId).toBeUndefined();
		expect(task?.assignmentToken).toBeUndefined();
		expect(task?.claimLeaseExpiresAt).toBeUndefined();
		expect(store.getDelegationsByOriginalTask('task-parent')).toHaveLength(0);
		expect(sendProtocolError).toHaveBeenCalledWith(
			expect.anything(),
			'retryable',
			'dispatch boom',
			expect.objectContaining({
				requestId: 'req-1',
				taskId: 'task-child',
				reasonCode: 'dispatch_failed',
			}),
		);
	});
});
