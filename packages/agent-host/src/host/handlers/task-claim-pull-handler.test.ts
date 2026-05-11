import { describe, expect, it, vi } from 'vitest';
import { createTaskBoardEntry } from '~/domain/task-board';
import { InMemoryStore } from '~/store/in-memory-store';
import { AgreementService } from '../services/agreement-service';
import { SessionExecutionService } from '../services/session-execution-service';
import { TaskBoardService } from '../services/task-board-service';
import { TaskClaimPullHandler } from './task-claim-pull-handler';

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

describe('TaskClaimPullHandler', () => {
	it('claims a todo claim task and returns task details', async () => {
		const store = new InMemoryStore();
		store.setWorker({
			agentId: 'exec-1',
			agentName: 'Exec 1',
			connectionId: undefined,
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: false,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workerProfile: undefined,
			workerType: 'session',
			workState: { kind: 'idle' },
			lastSeenAt: Date.now(),
		});
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-1',
				turnId: 'turn-1',
				prompt: 'do work',
				requesterConnectionId: 'conn-requester',
				requesterAgentId: 'lead-1',
				dispatchMode: 'claim',
			}),
		);

		const sent: Array<{
			connectionId: string;
			message: { type: string; payload: unknown };
		}> = [];
		const sessionExecutionService = new SessionExecutionService({
			store,
			agreementService: new AgreementService({
				store,
				onTransitionEvents: vi.fn(),
			}),
			taskBoardService: new TaskBoardService({
				store,
				onTransitionEvents: vi.fn(),
			}),
			transitionWorkerState: (agentId, next) => {
				const worker = store.getWorker(agentId);
				if (!worker) {
					return;
				}
				store.setWorker({
					...worker,
					workState: next,
					lastSeenAt: Date.now(),
				});
			},
			sendToConnection: vi.fn(async (connectionId, message) => {
				sent.push({ connectionId, message: message as never });
			}),
		});
		const handler = new TaskClaimPullHandler({
			store,
			preferredHoldMs: 5_000,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection: vi.fn(async (connectionId, message) => {
				sent.push({ connectionId, message: message as never });
			}),
			sessionExecutionService,
		});

		await handler.handleTaskClaimPull(createWorkerContext('exec-1') as never, {
			requestId: 'request-1',
			taskId: 'task-1',
		});

		expect(store.getTaskBoardEntry('task-1')).toEqual(
			expect.objectContaining({
				status: 'doing',
				assigneeId: 'exec-1',
			}),
		);
		expect(store.getCommitmentByTaskId('task-1')?.status).toBe('accepted');
		expect(store.getWorker('exec-1')?.workState).toEqual({
			kind: 'focused',
			taskId: 'task-1',
		});
		expect(sent).toContainEqual(
			expect.objectContaining({
				connectionId: 'conn-exec-1',
				message: expect.objectContaining({
					type: 'task:claim:pull:result',
					payload: expect.objectContaining({
						requestId: 'request-1',
						status: 'claimed',
						taskId: 'task-1',
					}),
				}),
			}),
		);
	});

	it('rejects when worker is already busy', async () => {
		const store = new InMemoryStore();
		store.setWorker({
			agentId: 'exec-1',
			agentName: 'Exec 1',
			connectionId: undefined,
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: false,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workerProfile: undefined,
			workerType: 'session',
			workState: { kind: 'focused', taskId: 'task-running' },
			lastSeenAt: Date.now(),
		});

		const sendToConnection = vi.fn(async () => {});
		const handler = new TaskClaimPullHandler({
			store,
			preferredHoldMs: 5_000,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection,
			sessionExecutionService: {} as never,
		});

		await handler.handleTaskClaimPull(createWorkerContext('exec-1') as never, {
			requestId: 'request-1',
			taskId: 'task-1',
		});

		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-exec-1',
			expect.objectContaining({
				type: 'task:claim:pull:result',
				payload: expect.objectContaining({
					status: 'rejected',
					reasonCode: 'worker_busy',
				}),
			}),
		);
	});

	it('rejects when task does not exist', async () => {
		const store = new InMemoryStore();
		store.setWorker({
			agentId: 'exec-1',
			agentName: 'Exec 1',
			connectionId: undefined,
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: false,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workerProfile: undefined,
			workerType: 'session',
			workState: { kind: 'idle' },
			lastSeenAt: Date.now(),
		});

		const sendToConnection = vi.fn(async () => {});
		const handler = new TaskClaimPullHandler({
			store,
			preferredHoldMs: 5_000,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection,
			sessionExecutionService: {} as never,
		});

		await handler.handleTaskClaimPull(createWorkerContext('exec-1') as never, {
			requestId: 'request-1',
			taskId: 'missing-task',
		});

		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-exec-1',
			expect.objectContaining({
				type: 'task:claim:pull:result',
				payload: expect.objectContaining({
					status: 'rejected',
					reasonCode: 'task_not_found',
				}),
			}),
		);
	});

	it('rejects when task is not claimable', async () => {
		const store = new InMemoryStore();
		store.setWorker({
			agentId: 'exec-1',
			agentName: 'Exec 1',
			connectionId: undefined,
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: false,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workerProfile: undefined,
			workerType: 'session',
			workState: { kind: 'idle' },
			lastSeenAt: Date.now(),
		});
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-1',
				turnId: 'turn-1',
				prompt: 'push work',
				requesterConnectionId: 'conn-requester',
				dispatchMode: 'push',
			}),
		);

		const sendToConnection = vi.fn(async () => {});
		const handler = new TaskClaimPullHandler({
			store,
			preferredHoldMs: 5_000,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection,
			sessionExecutionService: {} as never,
		});

		await handler.handleTaskClaimPull(createWorkerContext('exec-1') as never, {
			requestId: 'request-1',
			taskId: 'task-1',
		});

		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-exec-1',
			expect.objectContaining({
				type: 'task:claim:pull:result',
				payload: expect.objectContaining({
					status: 'rejected',
					reasonCode: 'task_not_claimable',
				}),
			}),
		);
	});

	it('rejects when task is already actively claimed by another worker', async () => {
		const store = new InMemoryStore();
		store.setWorker({
			agentId: 'exec-1',
			agentName: 'Exec 1',
			connectionId: undefined,
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: false,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workerProfile: undefined,
			workerType: 'session',
			workState: { kind: 'idle' },
			lastSeenAt: Date.now(),
		});
		store.setTaskBoardEntry({
			...createTaskBoardEntry({
				taskId: 'task-1',
				turnId: 'turn-1',
				prompt: 'claim work',
				requesterConnectionId: 'conn-requester',
				dispatchMode: 'claim',
			}),
			assigneeId: 'exec-2',
			assigneeName: 'Exec 2',
			assignmentToken: 'token-1',
			claimLeaseExpiresAt: Date.now() + 30_000,
			claimedAt: Date.now(),
		});

		const sendToConnection = vi.fn(async () => {});
		const handler = new TaskClaimPullHandler({
			store,
			preferredHoldMs: 5_000,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection,
			sessionExecutionService: {} as never,
		});

		await handler.handleTaskClaimPull(createWorkerContext('exec-1') as never, {
			requestId: 'request-1',
			taskId: 'task-1',
		});

		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-exec-1',
			expect.objectContaining({
				type: 'task:claim:pull:result',
				payload: expect.objectContaining({
					status: 'rejected',
					reasonCode: 'already_claimed',
				}),
			}),
		);
	});

	it('rejects when strict suggestion policy excludes the worker', async () => {
		const store = new InMemoryStore();
		store.setWorker({
			agentId: 'exec-1',
			agentName: 'Exec 1',
			connectionId: undefined,
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: false,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workerProfile: undefined,
			workerType: 'session',
			workState: { kind: 'idle' },
			lastSeenAt: Date.now(),
		});
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-1',
				turnId: 'turn-1',
				prompt: 'strict claim work',
				requesterConnectionId: 'conn-requester',
				dispatchMode: 'claim',
				suggestedAgentIds: ['exec-2'],
				suggestionPolicy: 'strict',
			}),
		);

		const sendToConnection = vi.fn(async () => {});
		const handler = new TaskClaimPullHandler({
			store,
			preferredHoldMs: 5_000,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection,
			sessionExecutionService: {} as never,
		});

		await handler.handleTaskClaimPull(createWorkerContext('exec-1') as never, {
			requestId: 'request-1',
			taskId: 'task-1',
		});

		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-exec-1',
			expect.objectContaining({
				type: 'task:claim:pull:result',
				payload: expect.objectContaining({
					status: 'rejected',
					reasonCode: 'suggestion_policy_mismatch',
				}),
			}),
		);
	});
});
