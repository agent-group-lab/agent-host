import { describe, expect, it, vi } from 'vitest';
import { createCommitmentRecord } from '~/domain/commitment';
import { applyTaskClaim, createTaskBoardEntry } from '~/domain/task-board';
import { InMemoryStore } from '~/store/in-memory-store';
import { AgreementService } from '../services/agreement-service';
import { TaskBoardService } from '../services/task-board-service';
import { TaskDeliverHandler } from './task-deliver-handler';

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

describe('TaskDeliverHandler', () => {
	it('marks task done, commitment delivered, and worker idle', async () => {
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
			workState: { kind: 'focused', taskId: 'task-1' },
			lastSeenAt: Date.now(),
		});
		const claimedTask = applyTaskClaim({
			task: createTaskBoardEntry({
				taskId: 'task-1',
				turnId: 'turn-1',
				prompt: 'do work',
				requesterConnectionId: 'conn-requester',
				dispatchMode: 'claim',
			}),
			assigneeId: 'exec-1',
			assigneeName: 'Exec 1',
			assignmentToken: 'token-1',
			claimLeaseMs: 10_000,
			claimLeaseExpiresAt: Date.now() + 10_000,
			executionLeaseMs: 30_000,
			at: Date.now(),
		});
		store.setTaskBoardEntry({
			...claimedTask,
			status: 'doing',
			startedAt: Date.now(),
		});
		const agreementService = new AgreementService({
			store,
			onTransitionEvents: vi.fn(),
		});
		const commitment = createCommitmentRecord(
			{
				commitmentId: 'commitment-1',
				taskId: 'task-1',
				assigneeId: 'exec-1',
				assigneeName: 'Exec 1',
			},
			Date.now(),
		);
		store.setCommitment(
			agreementService.applyCommitmentTransition({
				commitment,
				nextStatus: 'accepted',
				at: Date.now(),
			}),
		);

		const sent: Array<{
			connectionId: string;
			type: string;
			payload: unknown;
		}> = [];
		const handler = new TaskDeliverHandler({
			store,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection: vi.fn(async (connectionId, message) => {
				sent.push({
					connectionId,
					type: message.type,
					payload: message.payload,
				});
			}),
			taskBoardService: new TaskBoardService({
				store,
				onTransitionEvents: vi.fn(),
			}),
			agreementService,
			notificationService: {
				notifyParentTaskChildDelivered: vi.fn(async () => {}),
			} as never,
			dispatchNextWorkForWorker: vi.fn(async () => {}),
			transitionWorkerState: (agentId, nextState) => {
				const worker = store.getWorker(agentId);
				if (!worker) {
					return;
				}
				store.setWorker({
					...worker,
					workState: nextState,
					lastSeenAt: Date.now(),
				});
			},
			forceWorkerState: (agentId, nextState) => {
				const worker = store.getWorker(agentId);
				if (!worker) {
					return;
				}
				store.setWorker({
					...worker,
					workState: nextState,
					lastSeenAt: Date.now(),
				});
			},
		});

		await handler.handleTaskDeliver(createWorkerContext('exec-1') as never, {
			requestId: 'request-1',
			taskId: 'task-1',
			assignmentToken: 'token-1',
			artifact: { ok: true },
		});

		expect(store.getTaskBoardEntry('task-1')).toEqual(
			expect.objectContaining({
				status: 'done',
				deliveredArtifact: { ok: true },
			}),
		);
		expect(store.getCommitmentByTaskId('task-1')).toEqual(
			expect.objectContaining({
				status: 'delivered',
				deliveredRequestId: 'request-1',
			}),
		);
		expect(store.getWorker('exec-1')?.workState).toEqual({ kind: 'idle' });
		expect(sent).toContainEqual(
			expect.objectContaining({
				connectionId: 'conn-requester',
				type: 'task:completed',
			}),
		);
		expect(sent).toContainEqual(
			expect.objectContaining({
				connectionId: 'conn-exec-1',
				type: 'task:deliver:result',
				payload: expect.objectContaining({
					status: 'delivered',
				}),
			}),
		);
	});

	it('returns delivered for idempotent repeated delivery', async () => {
		const store = new InMemoryStore();
		store.setTaskBoardEntry({
			...createTaskBoardEntry({
				taskId: 'task-1',
				turnId: 'turn-1',
				prompt: 'done work',
				requesterConnectionId: 'conn-requester',
			}),
			status: 'done',
			assigneeId: 'exec-1',
		});
		store.setCommitment({
			...createCommitmentRecord(
				{
					commitmentId: 'commitment-1',
					taskId: 'task-1',
					assigneeId: 'exec-1',
					assigneeName: 'Exec 1',
				},
				Date.now(),
			),
			status: 'delivered',
			deliveredRequestId: 'request-1',
		});

		const sendToConnection = vi.fn(async () => {});
		const handler = new TaskDeliverHandler({
			store,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection,
			taskBoardService: {} as never,
			agreementService: {} as never,
			notificationService: {} as never,
			dispatchNextWorkForWorker: vi.fn(async () => {}),
			transitionWorkerState: vi.fn(),
			forceWorkerState: vi.fn(),
		});

		await handler.handleTaskDeliver(createWorkerContext('exec-1') as never, {
			requestId: 'request-2',
			taskId: 'task-1',
			assignmentToken: 'token-1',
		});

		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-exec-1',
			expect.objectContaining({
				type: 'task:deliver:result',
				payload: expect.objectContaining({
					status: 'delivered',
				}),
			}),
		);
	});

	it('returns conflict when assignment token does not match', async () => {
		const store = new InMemoryStore();
		store.setTaskBoardEntry({
			...createTaskBoardEntry({
				taskId: 'task-1',
				turnId: 'turn-1',
				prompt: 'doing work',
				requesterConnectionId: 'conn-requester',
			}),
			status: 'doing',
			assigneeId: 'exec-1',
			assigneeName: 'Exec 1',
			assignmentToken: 'token-1',
		});
		store.setCommitment({
			...createCommitmentRecord(
				{
					commitmentId: 'commitment-1',
					taskId: 'task-1',
					assigneeId: 'exec-1',
					assigneeName: 'Exec 1',
				},
				Date.now(),
			),
			status: 'accepted',
		});

		const sendToConnection = vi.fn(async () => {});
		const handler = new TaskDeliverHandler({
			store,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection,
			taskBoardService: {} as never,
			agreementService: {} as never,
			notificationService: {} as never,
			dispatchNextWorkForWorker: vi.fn(async () => {}),
			transitionWorkerState: vi.fn(),
			forceWorkerState: vi.fn(),
		});

		await handler.handleTaskDeliver(createWorkerContext('exec-1') as never, {
			requestId: 'request-1',
			taskId: 'task-1',
			assignmentToken: 'wrong-token',
		});

		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-exec-1',
			expect.objectContaining({
				type: 'task:deliver:result',
				payload: expect.objectContaining({
					status: 'conflict',
				}),
			}),
		);
	});

	it('returns conflict when task is assigned to another worker', async () => {
		const store = new InMemoryStore();
		store.setTaskBoardEntry({
			...createTaskBoardEntry({
				taskId: 'task-1',
				turnId: 'turn-1',
				prompt: 'doing work',
				requesterConnectionId: 'conn-requester',
			}),
			status: 'doing',
			assigneeId: 'exec-2',
			assigneeName: 'Exec 2',
			assignmentToken: 'token-1',
		});
		store.setCommitment({
			...createCommitmentRecord(
				{
					commitmentId: 'commitment-1',
					taskId: 'task-1',
					assigneeId: 'exec-2',
					assigneeName: 'Exec 2',
				},
				Date.now(),
			),
			status: 'accepted',
		});

		const sendToConnection = vi.fn(async () => {});
		const handler = new TaskDeliverHandler({
			store,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection,
			taskBoardService: {} as never,
			agreementService: {} as never,
			notificationService: {} as never,
			dispatchNextWorkForWorker: vi.fn(async () => {}),
			transitionWorkerState: vi.fn(),
			forceWorkerState: vi.fn(),
		});

		await handler.handleTaskDeliver(createWorkerContext('exec-1') as never, {
			requestId: 'request-1',
			taskId: 'task-1',
			assignmentToken: 'token-1',
		});

		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-exec-1',
			expect.objectContaining({
				type: 'task:deliver:result',
				payload: expect.objectContaining({
					status: 'conflict',
				}),
			}),
		);
	});

	it('unlocks blocked dependent task and dispatches persistent worker', async () => {
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
			workState: { kind: 'focused', taskId: 'task-1' },
			lastSeenAt: Date.now(),
		});
		store.setWorker({
			agentId: 'exec-2',
			agentName: 'Exec 2',
			connectionId: 'conn-exec-2',
			adapterId: 'codex',
			capabilities: {
				streaming: true,
				toolUse: true,
				codeExecution: true,
				fileRead: true,
				fileWrite: true,
			},
			agentRole: 'executor',
			workerProfile: undefined,
			workerType: 'persistent',
			workState: { kind: 'idle' },
			lastSeenAt: Date.now(),
		});
		const claimedTask = applyTaskClaim({
			task: createTaskBoardEntry({
				taskId: 'task-1',
				turnId: 'turn-1',
				prompt: 'root work',
				requesterConnectionId: 'conn-requester',
				dispatchMode: 'claim',
			}),
			assigneeId: 'exec-1',
			assigneeName: 'Exec 1',
			assignmentToken: 'token-1',
			claimLeaseMs: 10_000,
			claimLeaseExpiresAt: Date.now() + 10_000,
			executionLeaseMs: 30_000,
			at: Date.now(),
		});
		store.setTaskBoardEntry({
			...claimedTask,
			status: 'doing',
			startedAt: Date.now(),
		});
		store.setTaskBoardEntry({
			...createTaskBoardEntry({
				taskId: 'task-2',
				turnId: 'turn-2',
				prompt: 'blocked child',
				requesterConnectionId: 'conn-requester',
				dependencies: ['task-1'],
			}),
			status: 'blocked',
			assigneeId: 'exec-2',
			assigneeName: 'Exec 2',
		});
		const agreementService = new AgreementService({
			store,
			onTransitionEvents: vi.fn(),
		});
		const commitment = createCommitmentRecord(
			{
				commitmentId: 'commitment-1',
				taskId: 'task-1',
				assigneeId: 'exec-1',
				assigneeName: 'Exec 1',
			},
			Date.now(),
		);
		store.setCommitment(
			agreementService.applyCommitmentTransition({
				commitment,
				nextStatus: 'accepted',
				at: Date.now(),
			}),
		);

		const dispatchNextWorkForWorker = vi.fn(async () => {});
		const handler = new TaskDeliverHandler({
			store,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection: vi.fn(async () => {}),
			taskBoardService: new TaskBoardService({
				store,
				onTransitionEvents: vi.fn(),
			}),
			agreementService,
			notificationService: {
				notifyParentTaskChildDelivered: vi.fn(async () => {}),
			} as never,
			dispatchNextWorkForWorker,
			transitionWorkerState: (agentId, nextState) => {
				const worker = store.getWorker(agentId);
				if (!worker) {
					return;
				}
				store.setWorker({
					...worker,
					workState: nextState,
					lastSeenAt: Date.now(),
				});
			},
			forceWorkerState: (agentId, nextState) => {
				const worker = store.getWorker(agentId);
				if (!worker) {
					return;
				}
				store.setWorker({
					...worker,
					workState: nextState,
					lastSeenAt: Date.now(),
				});
			},
		});

		await handler.handleTaskDeliver(createWorkerContext('exec-1') as never, {
			requestId: 'request-1',
			taskId: 'task-1',
			assignmentToken: 'token-1',
		});

		expect(store.getTaskBoardEntry('task-2')).toEqual(
			expect.objectContaining({
				status: 'todo',
			}),
		);
		expect(dispatchNextWorkForWorker).toHaveBeenCalledWith('exec-2');
	});

	it('allows original worker to deliver after requeue when task is unclaimed', async () => {
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
			workState: { kind: 'offline' },
			lastSeenAt: Date.now(),
		});
		// Simulate a requeued task: status is todo, lastAssignmentToken set, assignmentToken cleared
		store.setTaskBoardEntry({
			...createTaskBoardEntry({
				taskId: 'task-1',
				turnId: 'turn-1',
				prompt: 'requeued work',
				requesterConnectionId: 'conn-requester',
				dispatchMode: 'claim',
			}),
			status: 'todo',
			lastAssignmentToken: 'token-1',
			claimAttempt: 1,
		});
		// Commitment was breached during requeue
		store.setCommitment({
			...createCommitmentRecord(
				{
					commitmentId: 'commitment-1',
					taskId: 'task-1',
					assigneeId: 'exec-1',
					assigneeName: 'Exec 1',
				},
				Date.now(),
			),
			status: 'breached',
			resolvedAt: Date.now(),
		});

		const sendToConnection = vi.fn(async () => {});
		const handler = new TaskDeliverHandler({
			store,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection,
			taskBoardService: new TaskBoardService({
				store,
				onTransitionEvents: vi.fn(),
			}),
			agreementService: {} as never,
			notificationService: {
				notifyParentTaskChildDelivered: vi.fn(async () => {}),
			} as never,
			dispatchNextWorkForWorker: vi.fn(async () => {}),
			transitionWorkerState: (agentId, nextState) => {
				const worker = store.getWorker(agentId);
				if (!worker) {
					return;
				}
				store.setWorker({
					...worker,
					workState: nextState,
					lastSeenAt: Date.now(),
				});
			},
			forceWorkerState: (agentId, nextState) => {
				const worker = store.getWorker(agentId);
				if (!worker) {
					return;
				}
				store.setWorker({
					...worker,
					workState: nextState,
					lastSeenAt: Date.now(),
				});
			},
		});

		await handler.handleTaskDeliver(createWorkerContext('exec-1') as never, {
			requestId: 'request-1',
			taskId: 'task-1',
			assignmentToken: 'token-1',
			artifact: { result: 'done' },
		});

		expect(store.getTaskBoardEntry('task-1')).toEqual(
			expect.objectContaining({
				status: 'done',
				deliveredArtifact: { result: 'done' },
				lastAssignmentToken: undefined,
			}),
		);
		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-exec-1',
			expect.objectContaining({
				type: 'task:deliver:result',
				payload: expect.objectContaining({ status: 'delivered' }),
			}),
		);
		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-requester',
			expect.objectContaining({ type: 'task:completed' }),
		);
	});

	it('rejects delivery when task is requeued and new worker has claimed it', async () => {
		const store = new InMemoryStore();
		// Task is now claimed by exec-2
		store.setTaskBoardEntry({
			...createTaskBoardEntry({
				taskId: 'task-1',
				turnId: 'turn-1',
				prompt: 'reclaimed work',
				requesterConnectionId: 'conn-requester',
				dispatchMode: 'claim',
			}),
			status: 'todo',
			assigneeId: 'exec-2',
			assignmentToken: 'token-2',
			lastAssignmentToken: undefined, // new claim cleared it
			claimAttempt: 1,
		});
		store.setCommitment({
			...createCommitmentRecord(
				{
					commitmentId: 'commitment-2',
					taskId: 'task-1',
					assigneeId: 'exec-2',
					assigneeName: 'Exec 2',
				},
				Date.now(),
			),
			status: 'accepted',
		});

		const sendToConnection = vi.fn(async () => {});
		const handler = new TaskDeliverHandler({
			store,
			sendProtocolError: vi.fn(async () => {}),
			sendToConnection,
			taskBoardService: {} as never,
			agreementService: {} as never,
			notificationService: {} as never,
			dispatchNextWorkForWorker: vi.fn(async () => {}),
			transitionWorkerState: vi.fn(),
			forceWorkerState: vi.fn(),
		});

		// exec-1 tries to deliver with old token-1
		await handler.handleTaskDeliver(createWorkerContext('exec-1') as never, {
			requestId: 'request-1',
			taskId: 'task-1',
			assignmentToken: 'token-1',
		});

		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-exec-1',
			expect.objectContaining({
				type: 'task:deliver:result',
				payload: expect.objectContaining({ status: 'rejected' }),
			}),
		);
	});
});
