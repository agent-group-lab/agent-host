import type {
	AgentRole,
	IDirectResponsePayload,
} from '@agent-group-lab/contracts/messages';
import type { IProtocolEnvelope } from '@agent-group-lab/protocol';
import { createEnvelope, PROTOCOL_VERSION } from '@agent-group-lab/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createTaskInboxWorkRef } from '~/domain/inbox';
import type { ITaskBoardEntry } from '~/domain/task-board';
import type { IHostPortConnection } from '~/ports/host-server-port';
import { InMemoryStore } from '~/store/in-memory-store';
import { HostCore } from './host-core';

const createMockConnection = (
	id: string,
): IHostPortConnection & {
	sent: IProtocolEnvelope<string, unknown>[];
} => {
	const sent: IProtocolEnvelope<string, unknown>[] = [];
	return {
		id,
		sent,
		send: vi.fn(async (message: IProtocolEnvelope<string, unknown>) => {
			sent.push(message);
		}),
		close: vi.fn(async () => {}),
	};
};

const makeReady = async (host: HostCore, conn: IHostPortConnection) => {
	await host.handleConnection(conn);
	await host.handleMessage(
		conn,
		createEnvelope({
			seq: 1,
			type: 'control:hello',
			channel: 'control',
			payload: { protoVersion: PROTOCOL_VERSION, appVersion: 'test' },
		}),
	);
};

const registerWorker = async (
	host: HostCore,
	conn: IHostPortConnection,
	agentId: string,
	role: AgentRole = 'executor',
) => {
	await makeReady(host, conn);
	await host.handleMessage(
		conn,
		createEnvelope({
			seq: 2,
			type: 'worker:register',
			channel: 'control',
			payload: {
				agentId,
				agentName: agentId,
				workerType: 'persistent',
				adapterId: 'test-adapter',
				role,
				capabilities: {
					streaming: true,
					toolUse: true,
					codeExecution: true,
					fileRead: true,
					fileWrite: true,
				},
			},
		}),
	);
};

describe('HostCore direct messaging', () => {
	it('routes direct:request to idle target worker', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-b');
		await registerWorker(host, workerConn, 'agent-b');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'direct:request',
				channel: 'direct:req-1',
				payload: {
					requestId: 'req-1',
					fromAgentId: 'agent-a',
					fromAgentName: 'agent-a',
					toAgentId: 'agent-b',
					toAgentName: 'agent-b',
					prompt: 'hello',
					workingDirectory: '/tmp',
				},
			}),
		);

		const workerMessages = workerConn.sent.filter(
			(m) => m.type === 'direct:request',
		);
		expect(workerMessages).toHaveLength(1);
		expect(
			(workerMessages[0].payload as Record<string, unknown>).requestId,
		).toBe('req-1');
		const ackMessages = clientConn.sent.filter(
			(message) => message.type === 'direct:response',
		);
		expect(ackMessages).toHaveLength(1);
		const ackPayload = ackMessages[0].payload as IDirectResponsePayload;
		expect(ackPayload.action).toBe('ACK');
		expect(ackPayload.ackKind).toBe('queued');
	});

	it('auto-ACKs when target is busy (deferred)', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-b');
		await registerWorker(host, workerConn, 'agent-b');

		// Make worker busy
		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-1',
				trace: { taskId: 'task-1', turnId: 'turn-1' },
				payload: {
					taskId: 'task-1',
					turnId: 'turn-1',
					prompt: 'do work',
					workingDirectory: '/tmp',
					agentId: 'agent-b',
				},
			}),
		);

		// Now send direct:request to busy worker
		const client2 = createMockConnection('conn-client-2');
		await makeReady(host, client2);

		await host.handleMessage(
			client2,
			createEnvelope({
				seq: 4,
				type: 'direct:request',
				channel: 'direct:req-2',
				payload: {
					requestId: 'req-2',
					fromAgentId: 'agent-a',
					fromAgentName: 'agent-a',
					toAgentId: 'agent-b',
					toAgentName: 'agent-b',
					prompt: 'hello busy',
					workingDirectory: '/tmp',
				},
			}),
		);

		const ackMessages = client2.sent.filter(
			(m) => m.type === 'direct:response',
		);
		expect(ackMessages).toHaveLength(1);
		const ackPayload = ackMessages[0].payload as IDirectResponsePayload;
		expect(ackPayload.action).toBe('ACK');
		expect(ackPayload.reason).toContain('busy');
	});

	it('routes direct:response back to requester', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-b');
		await registerWorker(host, workerConn, 'agent-b');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		// Send request
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'direct:request',
				channel: 'direct:req-1',
				payload: {
					requestId: 'req-1',
					fromAgentId: 'agent-a',
					fromAgentName: 'agent-a',
					toAgentId: 'agent-b',
					toAgentName: 'agent-b',
					prompt: 'hello',
					workingDirectory: '/tmp',
				},
			}),
		);

		// Worker sends response
		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 10,
				type: 'direct:response',
				channel: 'direct:req-1',
				payload: {
					requestId: 'req-1',
					fromAgentId: 'agent-b',
					fromAgentName: 'agent-b',
					toAgentId: 'agent-a',
					toAgentName: 'agent-a',
					action: 'DELIVER',
					content: 'world',
				},
			}),
		);

		const responses = clientConn.sent.filter(
			(message) =>
				message.type === 'direct:response' &&
				(message.payload as IDirectResponsePayload).action === 'DELIVER',
		);
		expect(responses).toHaveLength(1);
		const responsePayload = responses[0].payload as IDirectResponsePayload;
		expect(responsePayload.action).toBe('DELIVER');
		expect(responsePayload.content).toBe('world');
	});

	it('ignores duplicate requestId (idempotent)', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-b');
		await registerWorker(host, workerConn, 'agent-b');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		const directMsg = createEnvelope({
			seq: 3,
			type: 'direct:request',
			channel: 'direct:req-1',
			payload: {
				requestId: 'req-1',
				fromAgentId: 'agent-a',
				fromAgentName: 'agent-a',
				toAgentId: 'agent-b',
				toAgentName: 'agent-b',
				prompt: 'hello',
				workingDirectory: '/tmp',
			},
		});

		await host.handleMessage(clientConn, directMsg);
		await host.handleMessage(clientConn, directMsg);

		const workerRequests = workerConn.sent.filter(
			(m) => m.type === 'direct:request',
		);
		expect(workerRequests).toHaveLength(1);
	});

	it('ACKs when target agent is offline', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'direct:request',
				channel: 'direct:req-1',
				payload: {
					requestId: 'req-1',
					fromAgentId: 'agent-a',
					fromAgentName: 'agent-a',
					toAgentId: 'agent-nonexistent',
					toAgentName: 'agent-nonexistent',
					prompt: 'hello',
					workingDirectory: '/tmp',
				},
			}),
		);

		const ackMessages = clientConn.sent.filter(
			(m) => m.type === 'direct:response',
		);
		expect(ackMessages).toHaveLength(1);
		const ackPayload = ackMessages[0].payload as IDirectResponsePayload;
		expect(ackPayload.action).toBe('ACK');
		expect(ackPayload.reason).toContain('offline');
	});

	it('processes queued messages after task completion', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-b');
		await registerWorker(host, workerConn, 'agent-b');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		// Assign task to make worker busy
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-1',
				trace: { taskId: 'task-1', turnId: 'turn-1' },
				payload: {
					taskId: 'task-1',
					turnId: 'turn-1',
					prompt: 'do work',
					workingDirectory: '/tmp',
					agentId: 'agent-b',
				},
			}),
		);

		// Send direct:request while busy → queued
		const client2 = createMockConnection('conn-client-2');
		await makeReady(host, client2);

		await host.handleMessage(
			client2,
			createEnvelope({
				seq: 4,
				type: 'direct:request',
				channel: 'direct:req-queued',
				payload: {
					requestId: 'req-queued',
					fromAgentId: 'agent-a',
					fromAgentName: 'agent-a',
					toAgentId: 'agent-b',
					toAgentName: 'agent-b',
					prompt: 'queued message',
					workingDirectory: '/tmp',
				},
			}),
		);

		// Worker completes task → should dequeue
		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 20,
				type: 'task:completed',
				channel: 'task:task-1',
				trace: { taskId: 'task-1', turnId: 'turn-1' },
				payload: {
					taskId: 'task-1',
					agentId: 'agent-b',
					agentName: 'agent-b',
				},
			}),
		);

		// Queued message should now be delivered
		const directRequests = workerConn.sent.filter(
			(m) => m.type === 'direct:request',
		);
		expect(directRequests).toHaveLength(1);
		expect(
			(directRequests[0].payload as Record<string, unknown>).requestId,
		).toBe('req-queued');
	});

	it('dispatches older direct work before newer queued task work', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-b');
		await registerWorker(host, workerConn, 'agent-b');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-main',
				trace: { taskId: 'task-main', turnId: 'turn-main' },
				payload: {
					taskId: 'task-main',
					turnId: 'turn-main',
					prompt: 'main work',
					workingDirectory: '/tmp',
					agentId: 'agent-b',
				},
			}),
		);

		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 4,
				type: 'commitment:action',
				channel: 'task:task-main',
				payload: {
					action: 'ACCEPT',
					taskId: 'task-main',
				},
			}),
		);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 5,
				type: 'direct:request',
				channel: 'direct:req-old',
				payload: {
					requestId: 'req-old',
					fromAgentId: 'agent-a',
					fromAgentName: 'agent-a',
					toAgentId: 'agent-b',
					toAgentName: 'agent-b',
					prompt: 'older queued direct',
					workingDirectory: '/tmp',
				},
			}),
		);

		const queuedTask: ITaskBoardEntry = {
			taskId: 'task-new',
			turnId: 'turn-new',
			prompt: 'new task',
			workingDirectory: '/tmp',
			requesterConnectionId: clientConn.id,
			assigneeId: 'agent-b',
			assigneeName: undefined,
			assigneeRole: 'executor',
			status: 'todo',
			dependencies: [],
			createdAt: Date.now() + 10_000,
		};
		store.setTaskBoardEntry(queuedTask);

		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 6,
				type: 'task:completed',
				channel: 'task:task-main',
				trace: { taskId: 'task-main', turnId: 'turn-main' },
				payload: {
					taskId: 'task-main',
					agentId: 'agent-b',
					agentName: 'agent-b',
				},
			}),
		);

		const directRequests = workerConn.sent.filter(
			(message) => message.type === 'direct:request',
		);
		expect(directRequests).toHaveLength(1);
		expect(
			(directRequests[0].payload as Record<string, unknown>).requestId,
		).toBe('req-old');
		expect(
			workerConn.sent.filter(
				(message) =>
					message.type === 'task:assign' &&
					(message.trace as { taskId?: string } | undefined)?.taskId ===
						'task-new',
			),
		).toHaveLength(0);
	});

	it('dispatches queued task when older direct work is deferred by triage', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({
			store,
			triage: {
				evaluate: ({ requestId }) => {
					if (requestId === 'req-defer') {
						return { action: 'defer', ruleName: 'test-defer' };
					}
					return { action: 'deliver', ruleName: 'test-deliver' };
				},
			},
		});

		const workerConn = createMockConnection('conn-worker-b');
		await registerWorker(host, workerConn, 'agent-b');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-main',
				trace: { taskId: 'task-main', turnId: 'turn-main' },
				payload: {
					taskId: 'task-main',
					turnId: 'turn-main',
					prompt: 'main work',
					workingDirectory: '/tmp',
					agentId: 'agent-b',
				},
			}),
		);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 4,
				type: 'direct:request',
				channel: 'direct:req-defer',
				payload: {
					requestId: 'req-defer',
					fromAgentId: 'agent-a',
					fromAgentName: 'agent-a',
					toAgentId: 'agent-b',
					toAgentName: 'agent-b',
					prompt: 'keep deferred',
					workingDirectory: '/tmp',
				},
			}),
		);

		const queuedTask: ITaskBoardEntry = {
			taskId: 'task-next',
			turnId: 'turn-next',
			prompt: 'next task',
			workingDirectory: '/tmp',
			requesterConnectionId: clientConn.id,
			assigneeId: 'agent-b',
			assigneeName: undefined,
			assigneeRole: 'executor',
			status: 'todo',
			dependencies: [],
			createdAt: Date.now() + 10_000,
		};
		store.setTaskBoardEntry(queuedTask);
		store.setInboxEntry({
			entryId: 'inbox-task-next',
			toAgentId: 'agent-b',
			toAgentName: 'agent-b',
			fromAgentId: 'seed:task',
			fromAgentName: 'seed:task',
			requestId: 'task:task-next',
			status: 'queued',
			work: createTaskInboxWorkRef({
				taskId: 'task-next',
				targetAgentId: 'agent-b',
				sourceAgentId: 'seed:task',
			}),
			payload: {
				taskId: 'task-next',
				turnId: 'turn-next',
			},
			createdAt: Date.now() + 11_000,
			updatedAt: Date.now() + 11_000,
		});

		const queuedTaskWork = store
			.listInboxEntries({ toAgentId: 'agent-b', status: 'queued' })
			.filter((entry) => entry.work.workKind === 'task');
		expect(queuedTaskWork).toHaveLength(1);
		const taskWorkEntry = queuedTaskWork[0];
		if (taskWorkEntry?.work.workKind === 'task') {
			expect(taskWorkEntry.work.payloadRef.taskId).toBe('task-next');
		}

		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 6,
				type: 'task:completed',
				channel: 'task:task-main',
				trace: { taskId: 'task-main', turnId: 'turn-main' },
				payload: {
					taskId: 'task-main',
					agentId: 'agent-b',
					agentName: 'agent-b',
				},
			}),
		);

		const assignedNext = workerConn.sent.filter(
			(message) =>
				message.type === 'task:assign' &&
				(message.trace as { taskId?: string } | undefined)?.taskId ===
					'task-next',
		);
		expect(assignedNext).toHaveLength(1);

		const deferredDirectDeliveries = workerConn.sent.filter(
			(message) =>
				message.type === 'direct:request' &&
				((message.payload as Record<string, unknown>).requestId as string) ===
					'req-defer',
		);
		expect(deferredDirectDeliveries).toHaveLength(0);
	});

	it('dequeues after direct:response (worker transitions idle)', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-b');
		await registerWorker(host, workerConn, 'agent-b');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		// Send first direct:request → delivered (worker idle)
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'direct:request',
				channel: 'direct:req-1',
				payload: {
					requestId: 'req-1',
					fromAgentId: 'agent-a',
					fromAgentName: 'agent-a',
					toAgentId: 'agent-b',
					toAgentName: 'agent-b',
					prompt: 'first',
					workingDirectory: '/tmp',
				},
			}),
		);

		// Send second direct:request → queued (worker now focused)
		const client2 = createMockConnection('conn-client-2');
		await makeReady(host, client2);

		await host.handleMessage(
			client2,
			createEnvelope({
				seq: 4,
				type: 'direct:request',
				channel: 'direct:req-2',
				payload: {
					requestId: 'req-2',
					fromAgentId: 'agent-c',
					fromAgentName: 'agent-c',
					toAgentId: 'agent-b',
					toAgentName: 'agent-b',
					prompt: 'second',
					workingDirectory: '/tmp',
				},
			}),
		);

		// Worker sends direct:response for req-1 → should dequeue req-2
		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 10,
				type: 'direct:response',
				channel: 'direct:req-1',
				payload: {
					requestId: 'req-1',
					fromAgentId: 'agent-b',
					fromAgentName: 'agent-b',
					toAgentId: 'agent-a',
					toAgentName: 'agent-a',
					action: 'DELIVER',
					content: 'done',
				},
			}),
		);

		// req-2 should now be delivered to worker
		const directRequests = workerConn.sent.filter(
			(m) => m.type === 'direct:request',
		);
		expect(directRequests).toHaveLength(2);
		expect(
			(directRequests[1].payload as Record<string, unknown>).requestId,
		).toBe('req-2');
	});

	it('rejects direct:response from non-worker connection', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'direct:response',
				channel: 'direct:req-1',
				payload: {
					requestId: 'req-1',
					fromAgentId: 'agent-b',
					fromAgentName: 'agent-b',
					toAgentId: 'agent-a',
					toAgentName: 'agent-a',
					action: 'DELIVER',
					content: 'spoofed',
				},
			}),
		);

		// Should get a protocol error, not forwarded
		const errors = clientConn.sent.filter((m) => m.type === 'control:error');
		expect(errors).toHaveLength(1);
	});

	it('drops queued messages when worker disconnects', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-b');
		await registerWorker(host, workerConn, 'agent-b');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		// Assign task to make worker busy
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-1',
				trace: { taskId: 'task-1', turnId: 'turn-1' },
				payload: {
					taskId: 'task-1',
					turnId: 'turn-1',
					prompt: 'do work',
					workingDirectory: '/tmp',
					agentId: 'agent-b',
				},
			}),
		);

		// Queue a direct request
		const client2 = createMockConnection('conn-client-2');
		await makeReady(host, client2);

		await host.handleMessage(
			client2,
			createEnvelope({
				seq: 4,
				type: 'direct:request',
				channel: 'direct:req-drop',
				payload: {
					requestId: 'req-drop',
					fromAgentId: 'agent-a',
					fromAgentName: 'agent-a',
					toAgentId: 'agent-b',
					toAgentName: 'agent-b',
					prompt: 'will be dropped',
					workingDirectory: '/tmp',
				},
			}),
		);

		// Worker disconnects
		await host.handleDisconnect(workerConn, false);

		// Inbox entries should be dropped
		const entries = store.listInboxEntries({ toAgentId: 'agent-b' });
		for (const entry of entries) {
			expect(entry.status).toBe('dropped');
		}
	});

	it('cancels and notifies reserved task-board entry when worker disconnects while idle', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-b');
		await registerWorker(host, workerConn, 'agent-b');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		const taskBoard: ITaskBoardEntry = {
			taskId: 'task-reserved',
			turnId: 'turn-reserved',
			prompt: 'pending task',
			workingDirectory: '/tmp',
			requesterConnectionId: clientConn.id,
			assigneeId: 'agent-b',
			assigneeName: undefined,
			assigneeRole: 'executor',
			status: 'assigned',
			dependencies: [],
			createdAt: Date.now(),
		};
		store.setTaskBoardEntry(taskBoard);

		const now = Date.now();
		store.setInboxEntry({
			entryId: 'inbox-task-reserved',
			toAgentId: 'agent-b',
			toAgentName: 'agent-b',
			fromAgentId: 'source-agent',
			fromAgentName: 'source-agent',
			requestId: 'task:task-reserved',
			status: 'reserved',
			work: createTaskInboxWorkRef({
				taskId: 'task-reserved',
				targetAgentId: 'agent-b',
				sourceAgentId: 'source-agent',
			}),
			payload: {
				taskId: 'task-reserved',
				turnId: 'turn-reserved',
			},
			createdAt: now,
			updatedAt: now,
		});

		await host.handleDisconnect(workerConn, false);

		expect(store.getTaskBoardEntry('task-reserved')?.status).toBe('cancelled');
		expect(
			clientConn.sent.filter((message) => message.type === 'task:failed'),
		).toHaveLength(1);
		expect(
			clientConn.sent.filter((message) => message.type === 'control:error'),
		).toHaveLength(1);
	});

	it('does not mark session worker offline on disconnect', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const sessionConn = createMockConnection('conn-session');

		host.rehydrateConnection(sessionConn, {
			connectionId: 'conn-session',
			connectionRole: 'worker',
			agentId: 'session-agent',
			ready: true,
			connectedAt: Date.now(),
		});
		store.setWorker({
			agentId: 'session-agent',
			agentName: 'Session Agent',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'idle' },
			lastSeenAt: Date.now(),
		});

		await host.handleDisconnect(sessionConn, false);

		expect(store.getWorker('session-agent')?.workState).toEqual({
			kind: 'idle',
		});
	});

	it('does not mark focused session worker offline on disconnect', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const sessionConn = createMockConnection('conn-session-focused');

		host.rehydrateConnection(sessionConn, {
			connectionId: 'conn-session-focused',
			connectionRole: 'worker',
			agentId: 'session-agent',
			ready: true,
			connectedAt: Date.now(),
		});
		store.setWorker({
			agentId: 'session-agent',
			agentName: 'Session Agent',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'focused', taskId: 'task-focused' },
			lastSeenAt: Date.now(),
		});

		await host.handleDisconnect(sessionConn, false);

		expect(store.getWorker('session-agent')?.workState).toEqual({
			kind: 'focused',
			taskId: 'task-focused',
		});
	});

	it('returns admission_rejected ACK when worker spoofs fromAgentId', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerA = createMockConnection('conn-worker-a');
		const workerB = createMockConnection('conn-worker-b');
		await registerWorker(host, workerA, 'agent-a');
		await registerWorker(host, workerB, 'agent-b');

		await host.handleMessage(
			workerA,
			createEnvelope({
				seq: 3,
				type: 'direct:request',
				channel: 'direct:req-spoof',
				payload: {
					requestId: 'req-spoof',
					fromAgentId: 'agent-x',
					fromAgentName: 'agent-x',
					toAgentId: 'agent-b',
					toAgentName: 'agent-b',
					prompt: 'spoof',
					workingDirectory: '/tmp',
				},
			}),
		);

		const errors = workerA.sent.filter((m) => m.type === 'control:error');
		expect(errors).toHaveLength(1);
		const payload = errors[0].payload as { code: string; message: string };
		expect(payload.code).toBe('protocol');
		expect(payload.message).toContain('fromAgentId mismatch');
	});

	it('returns queued ACK metadata when target worker is busy', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-b');
		await registerWorker(host, workerConn, 'agent-b');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-1',
				trace: { taskId: 'task-1', turnId: 'turn-1' },
				payload: {
					taskId: 'task-1',
					turnId: 'turn-1',
					prompt: 'do work',
					workingDirectory: '/tmp',
					agentId: 'agent-b',
				},
			}),
		);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 4,
				type: 'direct:request',
				channel: 'direct:req-queued-meta',
				payload: {
					requestId: 'req-queued-meta',
					fromAgentId: 'agent-a',
					fromAgentName: 'agent-a',
					toAgentId: 'agent-b',
					toAgentName: 'agent-b',
					prompt: 'hello busy',
					workingDirectory: '/tmp',
				},
			}),
		);

		const ackMessages = clientConn.sent.filter(
			(m) => m.type === 'direct:response',
		);
		expect(ackMessages).toHaveLength(1);
		const ackPayload = ackMessages[0].payload as IDirectResponsePayload;
		expect(ackPayload.action).toBe('ACK');
		expect(ackPayload.origin).toBe('host');
		expect(ackPayload.ackKind).toBe('queued');
		expect(ackPayload.reasonCode).toBe('queued');
	});

	it('moves requester worker to waiting_peer and restores to focused on response', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerA = createMockConnection('conn-worker-a');
		const workerB = createMockConnection('conn-worker-b');
		await registerWorker(host, workerA, 'agent-a');
		await registerWorker(host, workerB, 'agent-b');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-1',
				trace: { taskId: 'task-1', turnId: 'turn-1' },
				payload: {
					taskId: 'task-1',
					turnId: 'turn-1',
					prompt: 'do work',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);

		await host.handleMessage(
			workerA,
			createEnvelope({
				seq: 10,
				type: 'direct:request',
				channel: 'direct:req-peer',
				payload: {
					requestId: 'req-peer',
					fromAgentId: 'agent-a',
					fromAgentName: 'agent-a',
					toAgentId: 'agent-b',
					toAgentName: 'agent-b',
					prompt: 'ask peer',
					workingDirectory: '/tmp',
					sourceTaskId: 'task-1',
				},
			}),
		);

		expect(store.getWorker('agent-a')?.workState.kind).toBe('waiting_peer');

		await host.handleMessage(
			workerB,
			createEnvelope({
				seq: 11,
				type: 'direct:response',
				channel: 'direct:req-peer',
				payload: {
					requestId: 'req-peer',
					fromAgentId: 'agent-b',
					fromAgentName: 'agent-b',
					toAgentId: 'agent-a',
					toAgentName: 'agent-a',
					action: 'DELIVER',
					content: 'done',
				},
			}),
		);

		expect(store.getWorker('agent-a')?.workState).toEqual({
			kind: 'focused',
			taskId: 'task-1',
		});
	});

	it('drops queued direct request on direct:cancel', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-b');
		await registerWorker(host, workerConn, 'agent-b');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-1',
				trace: { taskId: 'task-1', turnId: 'turn-1' },
				payload: {
					taskId: 'task-1',
					turnId: 'turn-1',
					prompt: 'do work',
					workingDirectory: '/tmp',
					agentId: 'agent-b',
				},
			}),
		);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 4,
				type: 'direct:request',
				channel: 'direct:req-cancel',
				payload: {
					requestId: 'req-cancel',
					fromAgentId: 'agent-a',
					fromAgentName: 'agent-a',
					toAgentId: 'agent-b',
					toAgentName: 'agent-b',
					prompt: 'queued',
					workingDirectory: '/tmp',
				},
			}),
		);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 5,
				type: 'direct:cancel',
				channel: 'direct:req-cancel',
				payload: {
					requestId: 'req-cancel',
					fromAgentId: 'agent-a',
					fromAgentName: 'agent-a',
					toAgentId: 'agent-b',
					toAgentName: 'agent-b',
					reasonCode: 'requester_cancelled',
				},
			}),
		);

		const entries = store.listInboxEntries({ toAgentId: 'agent-b' });
		const directEntry = entries.find(
			(entry) => entry.requestId === 'req-cancel',
		);
		expect(directEntry?.status).toBe('dropped');
	});

	it('recovers worker when direct:cancel arrives while direct entry is reserved', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		let unblockSend: () => void = () => {};
		const sendGate = new Promise<void>((resolve) => {
			unblockSend = resolve;
		});

		const workerConn = createMockConnection('conn-worker-b');
		workerConn.send = vi.fn(
			async (message: IProtocolEnvelope<string, unknown>) => {
				workerConn.sent.push(message);
				if (message.type === 'direct:request') {
					await sendGate;
				}
			},
		);
		await registerWorker(host, workerConn, 'agent-b');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		const directRequestPromise = host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'direct:request',
				channel: 'direct:req-race',
				payload: {
					requestId: 'req-race',
					fromAgentId: 'agent-a',
					fromAgentName: 'agent-a',
					toAgentId: 'agent-b',
					toAgentName: 'agent-b',
					prompt: 'race',
					workingDirectory: '/tmp',
				},
			}),
		);

		for (let i = 0; i < 20; i += 1) {
			const entry = store
				.listInboxEntries({ toAgentId: 'agent-b' })
				.find((item) => item.requestId === 'req-race');
			if (entry?.status === 'reserved') {
				break;
			}
			await Promise.resolve();
		}

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 4,
				type: 'direct:cancel',
				channel: 'direct:req-race',
				payload: {
					requestId: 'req-race',
					fromAgentId: 'agent-a',
					fromAgentName: 'agent-a',
					toAgentId: 'agent-b',
					toAgentName: 'agent-b',
					reasonCode: 'requester_cancelled',
				},
			}),
		);

		unblockSend();
		await directRequestPromise;

		const entry = store
			.listInboxEntries({ toAgentId: 'agent-b' })
			.find((item) => item.requestId === 'req-race');
		expect(entry?.status).toBe('dropped');
		expect(store.getWorker('agent-b')?.workState.kind).toBe('idle');
	});

	it('routes client task:assign without agentId to lead by default', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const leadConn = createMockConnection('conn-worker-lead');
		const workerConn = createMockConnection('conn-worker-a');
		await registerWorker(host, leadConn, 'agent-lead', 'lead');
		await registerWorker(host, workerConn, 'agent-a', 'executor');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-to-lead',
				trace: { taskId: 'task-to-lead', turnId: 'turn-1' },
				payload: {
					taskId: 'task-to-lead',
					turnId: 'turn-1',
					prompt: 'route to lead',
					workingDirectory: '/tmp',
				},
			}),
		);

		const leadAssignments = leadConn.sent.filter(
			(message) => message.type === 'task:assign',
		);
		const workerAssignments = workerConn.sent.filter(
			(message) => message.type === 'task:assign',
		);
		expect(leadAssignments).toHaveLength(1);
		expect(workerAssignments).toHaveLength(0);
	});

	it('returns retryable error when client assigns without agentId and no lead is available', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-a');
		await registerWorker(host, workerConn, 'agent-a', 'executor');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-no-lead',
				trace: { taskId: 'task-no-lead', turnId: 'turn-1' },
				payload: {
					taskId: 'task-no-lead',
					turnId: 'turn-1',
					prompt: 'no lead',
					workingDirectory: '/tmp',
				},
			}),
		);

		const errors = clientConn.sent.filter(
			(message) => message.type === 'control:error',
		);
		expect(errors).toHaveLength(1);
		expect((errors[0]?.payload as { code: string }).code).toBe('retryable');
		expect((errors[0]?.payload as { message: string }).message).toContain(
			'lead',
		);
	});

	it('allows lead worker to assign when agentId is explicit', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const leadConn = createMockConnection('conn-worker-lead');
		const workerConn = createMockConnection('conn-worker-a');
		await registerWorker(host, leadConn, 'agent-lead', 'lead');
		await registerWorker(host, workerConn, 'agent-a', 'executor');

		await host.handleMessage(
			leadConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-explicit',
				trace: { taskId: 'task-explicit', turnId: 'turn-1' },
				payload: {
					taskId: 'task-explicit',
					turnId: 'turn-1',
					prompt: 'assign explicitly',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);

		const workerAssignments = workerConn.sent.filter(
			(message) => message.type === 'task:assign',
		);
		const leadAccepted = leadConn.sent.filter(
			(message) => message.type === 'task:accepted',
		);
		expect(workerAssignments).toHaveLength(1);
		expect(leadAccepted).toHaveLength(0);
	});

	it('rejects lead worker task:assign without explicit agentId', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const leadConn = createMockConnection('conn-worker-lead');
		await registerWorker(host, leadConn, 'agent-lead', 'lead');

		await host.handleMessage(
			leadConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-missing-target',
				trace: { taskId: 'task-missing-target', turnId: 'turn-1' },
				payload: {
					taskId: 'task-missing-target',
					turnId: 'turn-1',
					prompt: 'missing agentId',
					workingDirectory: '/tmp',
				},
			}),
		);

		const errors = leadConn.sent.filter(
			(message) => message.type === 'control:error',
		);
		expect(errors).toHaveLength(1);
		expect((errors[0]?.payload as { message: string }).message).toContain(
			'explicit agentId',
		);
	});

	it('rejects worker task:assign when delegation target is self', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-a');
		await registerWorker(host, workerConn, 'agent-a', 'executor');

		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-reject-non-lead',
				trace: { taskId: 'task-reject-non-lead', turnId: 'turn-1' },
				payload: {
					taskId: 'task-reject-non-lead',
					turnId: 'turn-1',
					prompt: 'self delegation is invalid',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);

		const errors = workerConn.sent.filter(
			(message) => message.type === 'control:error',
		);
		expect(errors).toHaveLength(1);
		expect((errors[0]?.payload as { message: string }).message).toContain(
			'Delegation target cannot be self',
		);
	});

	it('allows executor to delegate accepted parent task', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerA = createMockConnection('conn-worker-a');
		const workerB = createMockConnection('conn-worker-b');
		await registerWorker(host, workerA, 'agent-a', 'executor');
		await registerWorker(host, workerB, 'agent-b', 'executor');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-parent',
				trace: { taskId: 'task-parent', turnId: 'turn-parent' },
				payload: {
					taskId: 'task-parent',
					turnId: 'turn-parent',
					prompt: 'parent',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);
		await host.handleMessage(
			workerA,
			createEnvelope({
				seq: 4,
				type: 'commitment:action',
				channel: 'task:task-parent',
				payload: {
					action: 'ACCEPT',
					taskId: 'task-parent',
				},
			}),
		);

		await host.handleMessage(
			workerA,
			createEnvelope({
				seq: 5,
				type: 'task:assign',
				channel: 'task:task-child',
				trace: { taskId: 'task-child', turnId: 'turn-child' },
				payload: {
					taskId: 'task-child',
					turnId: 'turn-child',
					prompt: 'child',
					workingDirectory: '/tmp',
					agentId: 'agent-b',
					parentTaskId: 'task-parent',
					deliverableSpec: 'child deliverable',
				},
			}),
		);

		expect(workerB.sent.filter((m) => m.type === 'task:assign')).toHaveLength(
			1,
		);
		const delegations = store.getDelegationsByOriginalTask('task-parent');
		expect(delegations).toHaveLength(1);
		expect(delegations[0]?.delegateeId).toBe('agent-b');
		expect(delegations[0]?.delegatedTaskId).toBe('task-child');
		expect(delegations[0]?.status).toBe('pending');
		expect(store.getTaskBoardEntry('task-child')?.parentTaskId).toBe(
			'task-parent',
		);
	});

	it('maps delegate_task tool events to waiting_delegation and back to focused', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerA = createMockConnection('conn-worker-a');
		await registerWorker(host, workerA, 'agent-a', 'executor');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-parent',
				trace: { taskId: 'task-parent', turnId: 'turn-parent' },
				payload: {
					taskId: 'task-parent',
					turnId: 'turn-parent',
					prompt: 'parent',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);

		expect(store.getWorker('agent-a')?.workState).toEqual({
			kind: 'focused',
			taskId: 'task-parent',
		});

		await host.handleMessage(
			workerA,
			createEnvelope({
				seq: 4,
				type: 'agent:event',
				channel: 'task:task-parent',
				payload: {
					taskId: 'task-parent',
					agentId: 'agent-a',
					agentName: 'agent-a',
					event: {
						id: 'event-tool-start',
						ts: Date.now(),
						turnId: 'turn-parent',
						taskId: 'task-parent',
						adapterId: 'test-adapter',
						type: 'tool:start',
						toolName: 'delegate_task',
						args: {},
					},
				},
			}),
		);
		expect(store.getWorker('agent-a')?.workState).toEqual({
			kind: 'waiting_delegation',
			taskId: 'task-parent',
			toolName: 'delegate_task',
		});

		await host.handleMessage(
			workerA,
			createEnvelope({
				seq: 5,
				type: 'agent:event',
				channel: 'task:task-parent',
				payload: {
					taskId: 'task-parent',
					agentId: 'agent-a',
					agentName: 'agent-a',
					event: {
						id: 'event-tool-done',
						ts: Date.now(),
						turnId: 'turn-parent',
						taskId: 'task-parent',
						adapterId: 'test-adapter',
						type: 'tool:done',
						toolName: 'delegate_task',
						output: '',
						isError: false,
					},
				},
			}),
		);
		expect(store.getWorker('agent-a')?.workState).toEqual({
			kind: 'focused',
			taskId: 'task-parent',
		});
	});

	it('keeps dependent task blocked until dependency is delivered, then dispatches it', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerA = createMockConnection('conn-worker-a');
		const workerB = createMockConnection('conn-worker-b');
		await registerWorker(host, workerA, 'agent-a', 'executor');
		await registerWorker(host, workerB, 'agent-b', 'executor');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:dep',
				trace: { taskId: 'task-dep', turnId: 'turn-dep' },
				payload: {
					taskId: 'task-dep',
					turnId: 'turn-dep',
					prompt: 'dependency',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 4,
				type: 'task:assign',
				channel: 'task:blocked',
				trace: { taskId: 'task-blocked', turnId: 'turn-blocked' },
				payload: {
					taskId: 'task-blocked',
					turnId: 'turn-blocked',
					prompt: 'blocked',
					workingDirectory: '/tmp',
					agentId: 'agent-b',
					dependencies: ['task-dep'],
				},
			}),
		);

		expect(store.getTaskBoardEntry('task-blocked')?.status).toBe('blocked');
		expect(workerB.sent.filter((m) => m.type === 'task:assign')).toHaveLength(
			0,
		);

		await host.handleMessage(
			workerA,
			createEnvelope({
				seq: 5,
				type: 'commitment:action',
				channel: 'task:dep',
				payload: {
					action: 'ACCEPT',
					taskId: 'task-dep',
				},
			}),
		);
		await host.handleMessage(
			workerA,
			createEnvelope({
				seq: 6,
				type: 'commitment:action',
				channel: 'task:dep',
				payload: {
					action: 'DELIVER',
					taskId: 'task-dep',
					artifact: 'ok',
				},
			}),
		);

		expect(store.getTaskBoardEntry('task-blocked')?.status).toBe('assigned');
		expect(workerB.sent.filter((m) => m.type === 'task:assign')).toHaveLength(
			1,
		);
	});

	it('creates accepted commitment and emits task:accepted on ACCEPT', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-a');
		await registerWorker(host, workerConn, 'agent-a', 'executor');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-accept',
				trace: { taskId: 'task-accept', turnId: 'turn-1' },
				payload: {
					taskId: 'task-accept',
					turnId: 'turn-1',
					prompt: 'work',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);
		expect(store.getTaskBoardEntry('task-accept')?.status).toBe('assigned');
		expect(
			clientConn.sent.filter((message) => message.type === 'task:accepted'),
		).toHaveLength(0);

		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 4,
				type: 'commitment:action',
				channel: 'task:task-accept',
				trace: { taskId: 'task-accept', turnId: 'turn-1' },
				payload: {
					action: 'ACCEPT',
					taskId: 'task-accept',
					deliverableSpec: 'summary',
				},
			}),
		);

		expect(store.getCommitmentByTaskId('task-accept')?.status).toBe('accepted');
		expect(store.getTaskBoardEntry('task-accept')?.status).toBe('doing');
		expect(
			clientConn.sent.filter((message) => message.type === 'task:accepted'),
		).toHaveLength(1);
		const updated = clientConn.sent.filter(
			(message) => message.type === 'commitment:updated',
		);
		expect(updated).toHaveLength(1);
		expect(
			(updated[0]?.payload as { status: string; action: string }).status,
		).toBe('accepted');
	});

	it('updates commitment progress on UPDATE without status change', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-a');
		await registerWorker(host, workerConn, 'agent-a', 'executor');
		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-update',
				trace: { taskId: 'task-update', turnId: 'turn-1' },
				payload: {
					taskId: 'task-update',
					turnId: 'turn-1',
					prompt: 'work',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);
		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 4,
				type: 'commitment:action',
				channel: 'task:task-update',
				payload: {
					action: 'ACCEPT',
					taskId: 'task-update',
				},
			}),
		);
		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 5,
				type: 'commitment:action',
				channel: 'task:task-update',
				payload: {
					action: 'UPDATE',
					taskId: 'task-update',
					progress: '50%',
				},
			}),
		);

		const commitment = store.getCommitmentByTaskId('task-update');
		expect(commitment?.status).toBe('accepted');
		expect(commitment?.progress).toBe('50%');
		const updates = clientConn.sent.filter(
			(message) => message.type === 'commitment:updated',
		);
		expect(updates).toHaveLength(2);
		expect(
			(updates.at(-1)?.payload as { action: string; status: string }).action,
		).toBe('UPDATE');
		expect(
			(updates.at(-1)?.payload as { action: string; status: string }).status,
		).toBe('accepted');
	});

	it('transitions commitment to delivered and emits task:completed on DELIVER', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-a');
		await registerWorker(host, workerConn, 'agent-a', 'executor');
		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-deliver',
				trace: { taskId: 'task-deliver', turnId: 'turn-1' },
				payload: {
					taskId: 'task-deliver',
					turnId: 'turn-1',
					prompt: 'work',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);
		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 4,
				type: 'commitment:action',
				channel: 'task:task-deliver',
				payload: {
					action: 'ACCEPT',
					taskId: 'task-deliver',
				},
			}),
		);
		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 5,
				type: 'commitment:action',
				channel: 'task:task-deliver',
				payload: {
					action: 'DELIVER',
					taskId: 'task-deliver',
					artifact: { file: 'out.md' },
				},
			}),
		);

		expect(store.getCommitmentByTaskId('task-deliver')?.status).toBe(
			'delivered',
		);
		expect(store.getTaskBoardEntry('task-deliver')?.status).toBe('done');
		expect(
			clientConn.sent.filter((message) => message.type === 'task:completed'),
		).toHaveLength(1);
	});

	it('tracks task work lifecycle in inbox (dispatched -> completed)', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-a');
		await registerWorker(host, workerConn, 'agent-a', 'executor');
		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-work-track',
				trace: { taskId: 'task-work-track', turnId: 'turn-track' },
				payload: {
					taskId: 'task-work-track',
					turnId: 'turn-track',
					prompt: 'track lifecycle',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);

		const dispatchedEntry = store
			.listInboxEntries({ toAgentId: 'agent-a' })
			.find((entry) => entry.work.workKind === 'task');
		expect(dispatchedEntry?.work.workId).toBe('task-work-track');
		expect(dispatchedEntry?.status).toBe('dispatched');

		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 4,
				type: 'commitment:action',
				channel: 'task:task-work-track',
				payload: {
					action: 'ACCEPT',
					taskId: 'task-work-track',
				},
			}),
		);
		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 5,
				type: 'commitment:action',
				channel: 'task:task-work-track',
				payload: {
					action: 'DELIVER',
					taskId: 'task-work-track',
					artifact: { content: 'done' },
				},
			}),
		);

		const completedEntry = store
			.listInboxEntries({ toAgentId: 'agent-a' })
			.find(
				(entry) =>
					entry.work.workKind === 'task' &&
					entry.work.workId === 'task-work-track',
			);
		expect(completedEntry?.status).toBe('completed');
	});

	it('marks task work as dropped when task fails', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-a');
		await registerWorker(host, workerConn, 'agent-a', 'executor');
		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-work-fail',
				trace: { taskId: 'task-work-fail', turnId: 'turn-fail' },
				payload: {
					taskId: 'task-work-fail',
					turnId: 'turn-fail',
					prompt: 'will fail',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);

		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 4,
				type: 'task:failed',
				channel: 'task:task-work-fail',
				payload: {
					taskId: 'task-work-fail',
					agentId: 'agent-a',
					agentName: 'agent-a',
					message: 'boom',
				},
			}),
		);

		const droppedEntry = store
			.listInboxEntries({ toAgentId: 'agent-a' })
			.find(
				(entry) =>
					entry.work.workKind === 'task' &&
					entry.work.workId === 'task-work-fail',
			);
		expect(droppedEntry?.status).toBe('dropped');
	});

	it('updates delegation record from pending to accepted/completed', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerA = createMockConnection('conn-worker-a');
		const workerB = createMockConnection('conn-worker-b');
		await registerWorker(host, workerA, 'agent-a', 'executor');
		await registerWorker(host, workerB, 'agent-b', 'executor');
		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:parent',
				trace: { taskId: 'task-parent-2', turnId: 'turn-parent-2' },
				payload: {
					taskId: 'task-parent-2',
					turnId: 'turn-parent-2',
					prompt: 'parent',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);
		await host.handleMessage(
			workerA,
			createEnvelope({
				seq: 4,
				type: 'commitment:action',
				channel: 'task:parent',
				payload: {
					action: 'ACCEPT',
					taskId: 'task-parent-2',
				},
			}),
		);
		await host.handleMessage(
			workerA,
			createEnvelope({
				seq: 5,
				type: 'task:assign',
				channel: 'task:child',
				trace: { taskId: 'task-child-2', turnId: 'turn-child-2' },
				payload: {
					taskId: 'task-child-2',
					turnId: 'turn-child-2',
					prompt: 'child',
					workingDirectory: '/tmp',
					agentId: 'agent-b',
					parentTaskId: 'task-parent-2',
				},
			}),
		);
		await host.handleMessage(
			workerB,
			createEnvelope({
				seq: 6,
				type: 'commitment:action',
				channel: 'task:child',
				payload: {
					action: 'ACCEPT',
					taskId: 'task-child-2',
				},
			}),
		);
		await host.handleMessage(
			workerB,
			createEnvelope({
				seq: 7,
				type: 'commitment:action',
				channel: 'task:child',
				payload: {
					action: 'DELIVER',
					taskId: 'task-child-2',
					artifact: 'child done',
				},
			}),
		);

		const delegation = store.getDelegationsByOriginalTask('task-parent-2')[0];
		expect(delegation?.status).toBe('completed');
	});

	it('notifies parent assignee when child task is delivered', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const leadConn = createMockConnection('conn-worker-lead');
		const workerB = createMockConnection('conn-worker-b');
		await registerWorker(host, leadConn, 'agent-lead', 'lead');
		await registerWorker(host, workerB, 'agent-b', 'executor');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:parent-3',
				trace: { taskId: 'task-parent-3', turnId: 'turn-parent-3' },
				payload: {
					taskId: 'task-parent-3',
					turnId: 'turn-parent-3',
					prompt: 'parent',
					workingDirectory: '/tmp',
				},
			}),
		);
		await host.handleMessage(
			leadConn,
			createEnvelope({
				seq: 4,
				type: 'commitment:action',
				channel: 'task:parent-3',
				payload: {
					action: 'ACCEPT',
					taskId: 'task-parent-3',
				},
			}),
		);
		await host.handleMessage(
			leadConn,
			createEnvelope({
				seq: 5,
				type: 'task:assign',
				channel: 'task:child-3',
				trace: { taskId: 'task-child-3', turnId: 'turn-child-3' },
				payload: {
					taskId: 'task-child-3',
					turnId: 'turn-child-3',
					prompt: 'child',
					workingDirectory: '/tmp',
					agentId: 'agent-b',
					parentTaskId: 'task-parent-3',
				},
			}),
		);
		await host.handleMessage(
			workerB,
			createEnvelope({
				seq: 6,
				type: 'commitment:action',
				channel: 'task:child-3',
				payload: {
					action: 'ACCEPT',
					taskId: 'task-child-3',
				},
			}),
		);
		await host.handleMessage(
			workerB,
			createEnvelope({
				seq: 7,
				type: 'commitment:action',
				channel: 'task:child-3',
				payload: {
					action: 'DELIVER',
					taskId: 'task-child-3',
					artifact: { output: 'ok' },
				},
			}),
		);

		const childDelivered = leadConn.sent.filter(
			(message) => message.type === 'task:child-delivered',
		);
		expect(childDelivered).toHaveLength(1);
		expect(
			(
				childDelivered[0]?.payload as {
					parentTaskId: string;
					childTaskId: string;
					allChildrenDone: boolean;
				}
			).parentTaskId,
		).toBe('task-parent-3');
		expect(
			(
				childDelivered[0]?.payload as {
					parentTaskId: string;
					childTaskId: string;
					allChildrenDone: boolean;
				}
			).childTaskId,
		).toBe('task-child-3');
		expect(
			(
				childDelivered[0]?.payload as {
					parentTaskId: string;
					childTaskId: string;
					allChildrenDone: boolean;
				}
			).allChildrenDone,
		).toBe(true);
		expect(
			leadConn.sent.filter(
				(message) => message.type === 'task:children-completed',
			),
		).toHaveLength(1);
	});

	it('breaches overdue accepted commitment and emits commitment:breached', async () => {
		const store = new InMemoryStore();
		let now = 1_000;
		const host = new HostCore({
			store,
			breachDetection: {
				enabled: true,
				now: () => now,
				reason: 'SLA timeout',
			},
		});

		const workerConn = createMockConnection('conn-worker-a');
		await registerWorker(host, workerConn, 'agent-a', 'executor');
		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-breach',
				trace: { taskId: 'task-breach', turnId: 'turn-breach' },
				payload: {
					taskId: 'task-breach',
					turnId: 'turn-breach',
					prompt: 'work',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);
		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 4,
				type: 'commitment:action',
				channel: 'task:task-breach',
				payload: {
					action: 'ACCEPT',
					taskId: 'task-breach',
					slaDeadline: 900,
				},
			}),
		);

		now = 2_000;
		await host.runMaintenance();

		expect(store.getCommitmentByTaskId('task-breach')?.status).toBe('breached');
		expect(
			clientConn.sent.filter(
				(message) => message.type === 'commitment:breached',
			),
		).toHaveLength(1);
		expect(
			clientConn.sent.filter((message) => message.type === 'task:failed'),
		).toHaveLength(1);
		await host.close();
	});

	it('breach detection also fails assigned task-board entries', async () => {
		const store = new InMemoryStore();
		let now = 1_000;
		const host = new HostCore({
			store,
			breachDetection: {
				enabled: true,
				now: () => now,
				reason: 'SLA timeout',
			},
		});

		const workerConn = createMockConnection('conn-worker-assigned');
		await registerWorker(host, workerConn, 'agent-assigned', 'executor');
		const clientConn = createMockConnection('conn-client-assigned');
		await makeReady(host, clientConn);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-breach-assigned',
				trace: {
					taskId: 'task-breach-assigned',
					turnId: 'turn-breach-assigned',
				},
				payload: {
					taskId: 'task-breach-assigned',
					turnId: 'turn-breach-assigned',
					prompt: 'work',
					workingDirectory: '/tmp',
					agentId: 'agent-assigned',
				},
			}),
		);
		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 4,
				type: 'commitment:action',
				channel: 'task:task-breach-assigned',
				payload: {
					action: 'ACCEPT',
					taskId: 'task-breach-assigned',
					slaDeadline: 900,
				},
			}),
		);

		const taskBoard = store.getTaskBoardEntry('task-breach-assigned');
		expect(taskBoard).toBeDefined();
		if (!taskBoard) {
			return;
		}
		store.setTaskBoardEntry({
			...taskBoard,
			status: 'assigned',
		});

		now = 2_000;
		await host.runMaintenance();

		expect(store.getTaskBoardEntry('task-breach-assigned')?.status).toBe(
			'cancelled',
		);
		expect(
			clientConn.sent.filter((message) => message.type === 'task:failed'),
		).toHaveLength(1);
		await host.close();
	});

	it('reaps expired session execution lease during maintenance', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({
			store,
			taskClaimV2Enabled: true,
		});
		const clientConn = createMockConnection('conn-client-exec-lease');
		await makeReady(host, clientConn);

		store.setWorker({
			agentId: 'session-agent',
			agentName: 'Session Agent',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'focused', taskId: 'task-lease' },
			lastSeenAt: Date.now(),
		});
		store.setTaskBoardEntry({
			taskId: 'task-lease',
			turnId: 'turn-lease',
			prompt: 'session work',
			workingDirectory: '/tmp',
			requesterConnectionId: clientConn.id,
			requesterAgentId: 'lead-1',
			assigneeId: 'session-agent',
			assigneeName: 'Session Agent',
			assigneeRole: 'executor',
			status: 'doing',
			dispatchMode: 'claim',
			assignmentToken: 'token-lease',
			claimLeaseExpiresAt: 1,
			executionLeaseExpiresAt: 1,
			claimAttempt: 5,
			claimedAt: 0,
			startedAt: 0,
			dependencies: [],
			createdAt: 0,
		});
		store.setCommitment({
			commitmentId: 'commitment-lease',
			taskId: 'task-lease',
			assigneeId: 'session-agent',
			assigneeName: 'Session Agent',
			status: 'accepted',
			createdAt: 0,
			acceptedAt: 0,
		});

		await host.runMaintenance();

		expect(store.getCommitmentByTaskId('task-lease')).toMatchObject({
			status: 'breached',
			failureReason: 'execution lease expired',
		});
		expect(store.getTaskBoardEntry('task-lease')).toMatchObject({
			status: 'cancelled',
			failureMessage: 'execution lease expired',
		});
		expect(store.getWorker('session-agent')?.workState).toEqual({
			kind: 'focused',
			taskId: 'task-lease',
		});
		expect(
			clientConn.sent.filter((message) => message.type === 'task:failed'),
		).toHaveLength(1);
	});

	it('defensively recovers expired session execution lease without commitment', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({
			store,
			taskClaimV2Enabled: true,
		});
		const clientConn = createMockConnection('conn-client-no-commitment');
		await makeReady(host, clientConn);

		store.setWorker({
			agentId: 'session-agent',
			agentName: 'Session Agent',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'focused', taskId: 'task-no-commitment' },
			lastSeenAt: Date.now(),
		});
		store.setTaskBoardEntry({
			taskId: 'task-no-commitment',
			turnId: 'turn-no-commitment',
			prompt: 'session work',
			workingDirectory: '/tmp',
			requesterConnectionId: clientConn.id,
			assigneeId: 'session-agent',
			assigneeName: 'Session Agent',
			assigneeRole: 'executor',
			status: 'doing',
			dispatchMode: 'claim',
			assignmentToken: 'token-no-commitment',
			claimLeaseExpiresAt: 1,
			executionLeaseExpiresAt: 1,
			claimAttempt: 5,
			claimedAt: 0,
			startedAt: 0,
			dependencies: [],
			createdAt: 0,
		});

		await host.runMaintenance();

		expect(store.getCommitmentByTaskId('task-no-commitment')).toBeUndefined();
		expect(store.getTaskBoardEntry('task-no-commitment')).toMatchObject({
			status: 'cancelled',
			failureMessage: 'execution lease expired',
		});
		expect(store.getWorker('session-agent')?.workState).toEqual({
			kind: 'focused',
			taskId: 'task-no-commitment',
		});
		expect(
			clientConn.sent.filter((message) => message.type === 'task:failed'),
		).toHaveLength(1);
	});

	it('rejects DELIVER before ACCEPT', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-a');
		await registerWorker(host, workerConn, 'agent-a', 'executor');
		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-deliver-no-accept',
				trace: { taskId: 'task-deliver-no-accept', turnId: 'turn-1' },
				payload: {
					taskId: 'task-deliver-no-accept',
					turnId: 'turn-1',
					prompt: 'work',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);

		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 4,
				type: 'commitment:action',
				channel: 'task:task-deliver-no-accept',
				payload: {
					action: 'DELIVER',
					taskId: 'task-deliver-no-accept',
					artifact: 'result',
				},
			}),
		);

		const errors = workerConn.sent.filter(
			(message) => message.type === 'control:error',
		);
		expect(errors).toHaveLength(1);
		expect((errors[0]?.payload as { message: string }).message).toContain(
			'no active commitment',
		);
	});

	it('reassigns task on DECLINE when another worker is available', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerA = createMockConnection('conn-worker-a');
		const workerB = createMockConnection('conn-worker-b');
		await registerWorker(host, workerA, 'agent-a', 'executor');
		await registerWorker(host, workerB, 'agent-b', 'executor');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-decline',
				trace: { taskId: 'task-decline', turnId: 'turn-1' },
				payload: {
					taskId: 'task-decline',
					turnId: 'turn-1',
					prompt: 'work',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);
		await host.handleMessage(
			workerA,
			createEnvelope({
				seq: 4,
				type: 'commitment:action',
				channel: 'task:task-decline',
				payload: {
					action: 'ACCEPT',
					taskId: 'task-decline',
				},
			}),
		);
		await host.handleMessage(
			workerA,
			createEnvelope({
				seq: 5,
				type: 'commitment:action',
				channel: 'task:task-decline',
				payload: {
					action: 'DECLINE',
					taskId: 'task-decline',
					reason: 'need different skill',
					suggestedAssignee: 'agent-b',
				},
			}),
		);

		expect(store.getTaskBoardEntry('task-decline')?.assigneeId).toBe('agent-b');
		expect(store.getTaskBoardEntry('task-decline')?.status).toBe('assigned');
		expect(workerB.sent.filter((m) => m.type === 'task:assign')).toHaveLength(
			1,
		);
		const updates = clientConn.sent.filter(
			(message) => message.type === 'commitment:updated',
		);
		expect(updates).toHaveLength(2);
		expect(
			(updates.at(-1)?.payload as { action: string; status: string }).action,
		).toBe('DECLINE');
		expect(
			(updates.at(-1)?.payload as { action: string; status: string }).status,
		).toBe('none');
	});

	it('emits task:escalated on ESCALATE', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerConn = createMockConnection('conn-worker-a');
		await registerWorker(host, workerConn, 'agent-a', 'executor');
		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-escalate',
				trace: { taskId: 'task-escalate', turnId: 'turn-1' },
				payload: {
					taskId: 'task-escalate',
					turnId: 'turn-1',
					prompt: 'work',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);
		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 4,
				type: 'commitment:action',
				channel: 'task:task-escalate',
				payload: {
					action: 'ACCEPT',
					taskId: 'task-escalate',
				},
			}),
		);
		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 5,
				type: 'commitment:action',
				channel: 'task:task-escalate',
				payload: {
					action: 'ESCALATE',
					taskId: 'task-escalate',
					decisionNeeded: 'Need product tradeoff',
				},
			}),
		);
		expect(
			clientConn.sent.filter((message) => message.type === 'task:escalated'),
		).toHaveLength(1);
		const updates = clientConn.sent.filter(
			(message) => message.type === 'commitment:updated',
		);
		expect(updates).toHaveLength(2);
		expect(
			(updates.at(-1)?.payload as { action: string; status: string }).action,
		).toBe('ESCALATE');
		expect(
			(updates.at(-1)?.payload as { action: string; status: string }).status,
		).toBe('accepted');
	});

	it('rejects role-disallowed commitment action', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const reviewerConn = createMockConnection('conn-worker-reviewer');
		await registerWorker(host, reviewerConn, 'agent-reviewer', 'reviewer');
		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'task:assign',
				channel: 'task:task-review',
				trace: { taskId: 'task-review', turnId: 'turn-1' },
				payload: {
					taskId: 'task-review',
					turnId: 'turn-1',
					prompt: 'review this',
					workingDirectory: '/tmp',
					agentId: 'agent-reviewer',
				},
			}),
		);
		await host.handleMessage(
			reviewerConn,
			createEnvelope({
				seq: 4,
				type: 'commitment:action',
				channel: 'task:task-review',
				payload: {
					action: 'FAIL',
					taskId: 'task-review',
					reason: 'cannot fail as reviewer role',
				},
			}),
		);
		const errors = reviewerConn.sent.filter(
			(message) => message.type === 'control:error',
		);
		expect(errors).toHaveLength(1);
		expect((errors[0]?.payload as { message: string }).message).toContain(
			'cannot perform action',
		);
	});

	it('allows worker connection to request workers:list for peer discovery', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		const workerA = createMockConnection('conn-worker-a');
		const workerB = createMockConnection('conn-worker-b');
		await registerWorker(host, workerA, 'agent-a');
		await registerWorker(host, workerB, 'agent-b');

		await host.handleMessage(
			workerA,
			createEnvelope({
				seq: 100,
				type: 'workers:list',
				channel: 'control',
				payload: {},
			}),
		);

		const results = workerA.sent.filter(
			(message) => message.type === 'workers:list:result',
		);
		expect(results).toHaveLength(1);
		const workers = (
			results[0]?.payload as {
				workers: Array<{ agentId: string }>;
			}
		).workers;
		expect(workers.map((worker) => worker.agentId).sort()).toEqual([
			'agent-a',
			'agent-b',
		]);

		const protocolErrors = workerA.sent.filter(
			(message) => message.type === 'control:error',
		);
		expect(protocolErrors).toHaveLength(0);
	});
});

describe('HostCore room messages', () => {
	it('stores and lists room messages for the target agent', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const conn = createMockConnection('conn-room-message');
		await makeReady(host, conn);

		await host.handleMessage(
			conn,
			createEnvelope({
				seq: 1,
				type: 'member:join',
				channel: 'control',
				payload: {
					agentId: 'agent-a',
					agentName: 'Agent A',
				},
			}),
		);
		await host.handleMessage(
			conn,
			createEnvelope({
				seq: 2,
				type: 'member:join',
				channel: 'control',
				payload: {
					agentId: 'agent-b',
					agentName: 'Agent B',
				},
			}),
		);
		await host.handleMessage(
			conn,
			createEnvelope({
				seq: 3,
				type: 'member:join',
				channel: 'control',
				payload: {
					agentId: 'agent-c',
					agentName: 'Agent C',
				},
			}),
		);

		await host.handleMessage(
			conn,
			createEnvelope({
				seq: 4,
				type: 'message:post',
				channel: 'control',
				payload: {
					messageId: 'message-1',
					fromAgentId: 'agent-a',
					fromAgentName: 'Agent A',
					toAgentId: 'agent-b',
					content: 'hello b',
				},
			}),
		);
		await host.handleMessage(
			conn,
			createEnvelope({
				seq: 5,
				type: 'message:post',
				channel: 'control',
				payload: {
					messageId: 'message-2',
					fromAgentId: 'agent-a',
					fromAgentName: 'Agent A',
					toAgentId: 'agent-c',
					content: 'hello c',
				},
			}),
		);
		await host.handleMessage(
			conn,
			createEnvelope({
				seq: 6,
				type: 'message:list',
				channel: 'control',
				payload: {
					toAgentId: 'agent-b',
					scope: 'all',
				},
			}),
		);

		expect(conn.sent.map((message) => message.type)).toEqual([
			'control:ready',
			'member:join:result',
			'member:join:result',
			'member:join:result',
			'message:post:result',
			'message:post:result',
			'message:list:result',
		]);
		const listResult = conn.sent.findLast(
			(message) => message.type === 'message:list:result',
		);
		expect(listResult?.payload).toMatchObject({
			messages: [
				{
					messageId: 'message-1',
					toAgentId: 'agent-b',
					content: 'hello b',
				},
			],
		});
	});

	it('rejects message:post when sender is unknown', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const conn = createMockConnection('conn-room-message-unknown-sender');
		await makeReady(host, conn);
		store.setMember({
			agentId: 'agent-b',
			agentName: 'Agent B',
			joinedAt: Date.now(),
		});

		await host.handleMessage(
			conn,
			createEnvelope({
				seq: 1,
				type: 'message:post',
				channel: 'control',
				payload: {
					messageId: 'message-1',
					fromAgentId: 'agent-a',
					fromAgentName: 'Agent A',
					toAgentId: 'agent-b',
					content: 'hello',
				},
			}),
		);

		expect(
			conn.sent.find((message) => message.type === 'control:error'),
		).toEqual(
			expect.objectContaining({
				type: 'control:error',
			}),
		);
		expect(store.getRoomMessage('message-1')).toBeUndefined();
	});

	it('rejects message:post when target is unknown', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const conn = createMockConnection('conn-room-message-unknown-target');
		await makeReady(host, conn);
		store.setMember({
			agentId: 'agent-a',
			agentName: 'Agent A',
			joinedAt: Date.now(),
		});

		await host.handleMessage(
			conn,
			createEnvelope({
				seq: 1,
				type: 'message:post',
				channel: 'control',
				payload: {
					messageId: 'message-1',
					fromAgentId: 'agent-a',
					fromAgentName: 'Agent A',
					toAgentId: 'agent-b',
					content: 'hello',
				},
			}),
		);

		expect(
			conn.sent.find((message) => message.type === 'control:error'),
		).toEqual(
			expect.objectContaining({
				type: 'control:error',
			}),
		);
		expect(store.getRoomMessage('message-1')).toBeUndefined();
	});

	it('removes expired room messages during maintenance', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		store.addRoomMessage({
			messageId: 'message-expired',
			fromAgentId: 'agent-a',
			fromAgentName: 'Agent A',
			toAgentId: 'agent-b',
			content: 'expired',
			createdAt: Date.now() - 100,
			expiresAt: Date.now() - 1,
		});

		await host.runMaintenance();

		expect(store.getRoomMessage('message-expired')).toBeUndefined();
	});
});

describe('HostCore membership', () => {
	it('marks inactive session workers offline after idle TTL without leaving membership', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const now = Date.now();

		store.setMember({
			agentId: 'session-agent',
			agentName: 'Session Agent',
			joinedAt: now - 20 * 60_000,
		});
		store.setWorker({
			agentId: 'session-agent',
			agentName: 'Session Agent',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'idle' },
			lastSeenAt: now - 11 * 60_000,
		});

		await host.runMaintenance();

		expect(store.getWorker('session-agent')?.workState).toEqual({
			kind: 'offline',
		});
		expect(store.getMember('session-agent')).toEqual(
			expect.objectContaining({
				agentId: 'session-agent',
			}),
		);
	});

	it('auto-leaves offline session members and deletes worker records after offline retention TTL', async () => {
		const store = new InMemoryStore();
		const transitionEvents: string[][] = [];
		const host = new HostCore({
			store,
			eventOutputPort: {
				onTransitionEvents: (events) => {
					transitionEvents.push(events.map((event) => event.eventType));
				},
			},
		});
		const now = Date.now();

		store.setMember({
			agentId: 'session-agent',
			agentName: 'Session Agent',
			joinedAt: now - 3 * 24 * 60 * 60_000,
		});
		store.setWorker({
			agentId: 'session-agent',
			agentName: 'Session Agent',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'offline' },
			lastSeenAt: now - 25 * 60 * 60_000,
		});

		await host.runMaintenance();

		expect(store.getMember('session-agent')).toBeUndefined();
		expect(store.getWorker('session-agent')).toBeUndefined();
		expect(transitionEvents).toEqual([
			['membership:status_changed', 'membership:left'],
		]);
	});

	it('keeps offline session members when worker records still have active references', async () => {
		const store = new InMemoryStore();
		const transitionEvents: string[][] = [];
		const host = new HostCore({
			store,
			eventOutputPort: {
				onTransitionEvents: (events) => {
					transitionEvents.push(events.map((event) => event.eventType));
				},
			},
		});
		const now = Date.now();

		store.setMember({
			agentId: 'session-agent',
			agentName: 'Session Agent',
			joinedAt: now - 3 * 24 * 60 * 60_000,
		});
		store.setWorker({
			agentId: 'session-agent',
			agentName: 'Session Agent',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'offline' },
			lastSeenAt: now - 25 * 60 * 60_000,
		});
		store.setTaskBoardEntry({
			taskId: 'task-active',
			turnId: 'turn-active',
			prompt: 'still referenced',
			requesterConnectionId: 'conn-client',
			status: 'blocked',
			dependencies: [],
			assigneeId: 'session-agent',
			assigneeName: 'Session Agent',
			createdAt: now,
		});

		await host.runMaintenance();

		expect(store.getMember('session-agent')).toEqual(
			expect.objectContaining({
				agentId: 'session-agent',
			}),
		);
		expect(store.getWorker('session-agent')).toEqual(
			expect.objectContaining({
				agentId: 'session-agent',
			}),
		);
		expect(transitionEvents).toEqual([]);
	});

	it('lists inbox entries for a target agent with derived online state', async () => {
		const store = new InMemoryStore();
		store.setInboxEntry({
			entryId: 'inbox-1',
			toAgentId: 'agent-a',
			toAgentName: 'Agent A',
			fromAgentId: 'agent-b',
			fromAgentName: 'Agent B',
			requestId: 'request-1',
			status: 'queued',
			work: createTaskInboxWorkRef({
				taskId: 'task-1',
				targetAgentId: 'agent-a',
				sourceAgentId: 'agent-b',
			}),
			payload: { prompt: 'Do work' },
			createdAt: 100,
			updatedAt: 101,
		});
		const host = new HostCore({ store });
		const clientConn = createMockConnection('conn-client-inbox-list');
		await makeReady(host, clientConn);

		const workerConn = createMockConnection('conn-worker-inbox-list');
		await registerWorker(host, workerConn, 'agent-a');

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 1,
				type: 'inbox:list',
				channel: 'control',
				payload: {
					targetAgentId: 'agent-a',
				},
			}),
		);

		const results = clientConn.sent.filter(
			(message) => message.type === 'inbox:list:result',
		);
		expect(results).toHaveLength(1);
		expect(results[0]?.payload).toEqual({
			targetAgentId: 'agent-a',
			entries: [
				{
					entryId: 'inbox-1',
					toAgentId: 'agent-a',
					toAgentName: 'Agent A',
					fromAgentId: 'agent-b',
					fromAgentName: 'Agent B',
					requestId: 'request-1',
					status: 'queued',
					work: createTaskInboxWorkRef({
						taskId: 'task-1',
						targetAgentId: 'agent-a',
						sourceAgentId: 'agent-b',
					}),
					payload: { prompt: 'Do work' },
					createdAt: 100,
					updatedAt: 101,
					online: true,
					workState: { kind: 'idle' },
				},
			],
		});
	});

	it('joins members idempotently and emits transition events once', async () => {
		const store = new InMemoryStore();
		const transitionEvents: string[][] = [];
		const host = new HostCore({
			store,
			eventOutputPort: {
				onTransitionEvents: (events) => {
					transitionEvents.push(events.map((event) => event.eventType));
				},
			},
		});
		const clientConn = createMockConnection('conn-client-membership');
		await makeReady(host, clientConn);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 1,
				type: 'member:join',
				channel: 'control',
				payload: {
					agentId: 'agent-a',
					agentName: 'Agent A',
				},
			}),
		);

		const firstJoin = clientConn.sent.filter(
			(message) => message.type === 'member:join:result',
		);
		expect(firstJoin).toHaveLength(1);
		expect(firstJoin[0]?.payload).toMatchObject({
			agentId: 'agent-a',
			agentName: 'Agent A',
		});
		const joinedAt = (
			firstJoin[0]?.payload as {
				joinedAt: number;
			}
		).joinedAt;

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 2,
				type: 'member:join',
				channel: 'control',
				payload: {
					agentId: 'agent-a',
					agentName: 'Agent A Renamed',
				},
			}),
		);

		const joinResults = clientConn.sent.filter(
			(message) => message.type === 'member:join:result',
		);
		expect(joinResults).toHaveLength(2);
		expect(joinResults[1]?.payload).toMatchObject({
			agentId: 'agent-a',
			agentName: 'Agent A Renamed',
			joinedAt,
		});
		expect(store.getMember('agent-a')).toEqual({
			agentId: 'agent-a',
			agentName: 'Agent A Renamed',
			joinedAt,
		});
		expect(transitionEvents).toEqual([
			['membership:status_changed', 'membership:joined'],
		]);
	});

	it('lists members with derived online state', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const clientConn = createMockConnection('conn-client-list');
		await makeReady(host, clientConn);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 1,
				type: 'member:join',
				channel: 'control',
				payload: {
					agentId: 'agent-a',
					agentName: 'Agent A',
				},
			}),
		);

		const workerConn = createMockConnection('conn-worker-member');
		await registerWorker(host, workerConn, 'agent-a');

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 2,
				type: 'member:list',
				channel: 'control',
				payload: {},
			}),
		);

		const results = clientConn.sent.filter(
			(message) => message.type === 'member:list:result',
		);
		expect(results).toHaveLength(1);
		expect(
			(
				results[0]?.payload as {
					members: Array<{
						agentId: string;
						online: boolean;
						workState: { kind: string } | null;
					}>;
				}
			).members,
		).toEqual([
			expect.objectContaining({
				agentId: 'agent-a',
				online: true,
				workState: { kind: 'idle' },
			}),
		]);
	});

	it('auto-joins membership on worker register and preserves joinedAt for existing member', async () => {
		const store = new InMemoryStore();
		const transitionEvents: string[][] = [];
		const host = new HostCore({
			store,
			eventOutputPort: {
				onTransitionEvents: (events) => {
					transitionEvents.push(events.map((event) => event.eventType));
				},
			},
		});

		const workerConn = createMockConnection('conn-worker-auto-join');
		await registerWorker(host, workerConn, 'agent-auto');
		const firstMember = store.getMember('agent-auto');
		expect(firstMember).toEqual(
			expect.objectContaining({
				agentId: 'agent-auto',
				agentName: 'agent-auto',
			}),
		);
		expect(transitionEvents).toContainEqual([
			'membership:status_changed',
			'membership:joined',
		]);

		const existingJoinedAt = firstMember?.joinedAt;
		if (!existingJoinedAt) {
			throw new Error('Expected joinedAt to be set for auto-joined member');
		}

		const clientConn = createMockConnection('conn-client-existing-member');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 10,
				type: 'member:join',
				channel: 'control',
				payload: {
					agentId: 'agent-existing',
					agentName: 'Existing Member',
				},
			}),
		);
		const existingMember = store.getMember('agent-existing');
		if (!existingMember) {
			throw new Error('Expected member:join to create existing member');
		}

		const workerConnExisting = createMockConnection(
			'conn-worker-existing-member',
		);
		await makeReady(host, workerConnExisting);
		await host.handleMessage(
			workerConnExisting,
			createEnvelope({
				seq: 11,
				type: 'worker:register',
				channel: 'control',
				payload: {
					agentId: 'agent-existing',
					agentName: 'Existing Member Renamed',
					workerType: 'persistent',
					adapterId: 'test-adapter',
					role: 'executor',
					capabilities: {
						streaming: true,
						toolUse: true,
						codeExecution: true,
						fileRead: true,
						fileWrite: true,
					},
				},
			}),
		);

		expect(store.getMember('agent-existing')).toEqual({
			agentId: 'agent-existing',
			agentName: 'Existing Member Renamed',
			joinedAt: existingMember.joinedAt,
		});
		expect(store.getMember('agent-auto')?.joinedAt).toBe(existingJoinedAt);
		expect(
			transitionEvents.filter((events) => events.includes('membership:joined')),
		).toHaveLength(2);
	});

	it('leaves members without touching worker records and keeps membership on disconnect', async () => {
		const store = new InMemoryStore();
		const transitionEvents: string[][] = [];
		const host = new HostCore({
			store,
			eventOutputPort: {
				onTransitionEvents: (events) => {
					transitionEvents.push(events.map((event) => event.eventType));
				},
			},
		});
		const clientConn = createMockConnection('conn-client-leave');
		await makeReady(host, clientConn);

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 1,
				type: 'member:join',
				channel: 'control',
				payload: {
					agentId: 'agent-a',
					agentName: 'Agent A',
				},
			}),
		);

		const workerConn = createMockConnection('conn-worker-leave');
		await registerWorker(host, workerConn, 'agent-a');
		await host.handleDisconnect(workerConn, false);
		expect(store.getMember('agent-a')).toEqual(
			expect.objectContaining({
				agentId: 'agent-a',
			}),
		);
		expect(store.getWorker('agent-a')?.workState.kind).toBe('offline');

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 2,
				type: 'member:leave',
				channel: 'control',
				payload: {
					agentId: 'agent-a',
				},
			}),
		);

		const leaveResults = clientConn.sent.filter(
			(message) => message.type === 'member:leave:result',
		);
		expect(leaveResults).toHaveLength(1);
		expect(leaveResults[0]?.payload).toEqual({
			agentId: 'agent-a',
			removed: true,
		});
		expect(store.getMember('agent-a')).toBeUndefined();
		expect(store.getWorker('agent-a')?.agentId).toBe('agent-a');
		expect(transitionEvents).toEqual([
			['membership:status_changed', 'membership:joined'],
			['work:status_changed', 'work:online'],
			['work:status_changed', 'work:offline'],
			['membership:status_changed', 'membership:left'],
		]);
	});
});

describe('HostCore getNextMaintenanceAt', () => {
	it('returns the earliest pending maintenance deadline across all tracked sources', () => {
		const store = new InMemoryStore();
		const host = new HostCore({
			store,
			taskClaimV2Enabled: true,
			breachDetection: {
				enabled: true,
			},
		});
		const now = 1_000_000;

		store.setMember({
			agentId: 'session-idle',
			agentName: 'Session Idle',
			joinedAt: now - 1,
		});
		store.setMember({
			agentId: 'session-offline',
			agentName: 'Session Offline',
			joinedAt: now - 1,
		});
		store.setWorker({
			agentId: 'session-idle',
			agentName: 'Session Idle',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'idle' },
			lastSeenAt: now - 5 * 60_000 + 5_000,
		});
		store.setWorker({
			agentId: 'session-offline',
			agentName: 'Session Offline',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'offline' },
			lastSeenAt: now - 10 * 60_000 + 30_000,
		});
		store.setWorker({
			agentId: 'session-doing',
			agentName: 'Session Doing',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'focused', taskId: 'task-doing' },
			lastSeenAt: now,
		});
		store.setWorker({
			agentId: 'session-gc',
			agentName: 'Session GC',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'offline' },
			lastSeenAt: now - 10 * 60_000 + 8_000,
		});

		store.setTaskBoardEntry({
			taskId: 'task-claim',
			turnId: 'turn-claim',
			prompt: 'claim task',
			requesterConnectionId: 'conn-client',
			status: 'todo',
			dependencies: [],
			dispatchMode: 'claim',
			assigneeId: 'session-idle',
			assigneeName: 'Session Idle',
			claimLeaseMs: 30_000,
			claimLeaseExpiresAt: now + 4_000,
			executionLeaseMs: 30_000,
			createdAt: now,
		});
		store.setTaskBoardEntry({
			taskId: 'task-doing',
			turnId: 'turn-doing',
			prompt: 'doing task',
			requesterConnectionId: 'conn-client',
			status: 'doing',
			dependencies: [],
			dispatchMode: 'claim',
			assigneeId: 'session-doing',
			assigneeName: 'Session Doing',
			executionLeaseMs: 30_000,
			executionLeaseExpiresAt: now + 3_000,
			createdAt: now,
		});

		store.setCommitment({
			commitmentId: 'commitment-1',
			taskId: 'task-commitment',
			assigneeId: 'session-idle',
			assigneeName: 'Session Idle',
			status: 'accepted',
			slaDeadline: now + 2_000,
			createdAt: now,
		});

		store.addRoomMessage({
			messageId: 'message-1',
			fromAgentId: 'session-idle',
			fromAgentName: 'Session Idle',
			toAgentId: 'session-offline',
			toAgentName: 'Session Offline',
			content: 'hello',
			createdAt: now,
			expiresAt: now + 1_000,
		});

		expect(host.getNextMaintenanceAt(now)).toBe(now + 1_000);
	});

	it('clamps overdue maintenance to now', () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const now = 5_000;

		store.addRoomMessage({
			messageId: 'message-overdue',
			fromAgentId: 'agent-a',
			fromAgentName: 'Agent A',
			toAgentId: 'agent-b',
			toAgentName: 'Agent B',
			content: 'expired',
			createdAt: now - 100,
			expiresAt: now - 1,
		});

		expect(host.getNextMaintenanceAt(now)).toBe(now);
	});

	it('returns undefined when no maintenance source is pending', () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		expect(host.getNextMaintenanceAt(10_000)).toBeUndefined();
	});

	it('returns now for members without worker records', () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const now = 1_000_000;

		store.setMember({
			agentId: 'orphan-member',
			agentName: 'Orphan Member',
			joinedAt: now - 60_000,
		});

		expect(host.getNextMaintenanceAt(now)).toBe(now);
	});

	it('returns offline retention TTL for offline session workers without membership', () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const now = 1_000_000;

		store.setWorker({
			agentId: 'session-gc',
			agentName: 'Session GC',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'offline' },
			lastSeenAt: now - 10 * 60_000 + 5_000,
		});

		expect(host.getNextMaintenanceAt(now)).toBe(now + 5_000);
	});

	it('does not schedule offline retention cleanup for workers with active task references', () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const now = 1_000_000;

		store.setWorker({
			agentId: 'session-gc',
			agentName: 'Session GC',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'offline' },
			lastSeenAt: now - 10 * 60_000 + 5_000,
		});
		store.setTaskBoardEntry({
			taskId: 'task-active',
			turnId: 'turn-active',
			prompt: 'still referenced',
			requesterConnectionId: 'conn-client',
			status: 'blocked',
			dependencies: [],
			assigneeId: 'session-gc',
			assigneeName: 'Session GC',
			createdAt: now,
		});

		expect(host.getNextMaintenanceAt(now)).toBeUndefined();
	});

	it('does not schedule offline member cleanup while worker records have active task references', () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const now = 1_000_000;

		store.setMember({
			agentId: 'session-gc',
			agentName: 'Session GC',
			joinedAt: now - 60_000,
		});
		store.setWorker({
			agentId: 'session-gc',
			agentName: 'Session GC',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'offline' },
			lastSeenAt: now - 10 * 60_000 + 5_000,
		});
		store.setTaskBoardEntry({
			taskId: 'task-active',
			turnId: 'turn-active',
			prompt: 'still referenced',
			requesterConnectionId: 'conn-client',
			status: 'blocked',
			dependencies: [],
			assigneeId: 'session-gc',
			assigneeName: 'Session GC',
			createdAt: now,
		});

		expect(host.getNextMaintenanceAt(now)).toBeUndefined();
	});
});

describe('HostCore worker GC', () => {
	it('deletes members without worker records during maintenance', async () => {
		const store = new InMemoryStore();
		const transitionEvents: string[][] = [];
		const host = new HostCore({
			store,
			eventOutputPort: {
				onTransitionEvents: (events) => {
					transitionEvents.push(events.map((event) => event.eventType));
				},
			},
		});

		store.setMember({
			agentId: 'orphan-member',
			agentName: 'Orphan Member',
			joinedAt: Date.now() - 60_000,
		});

		await host.runMaintenance();

		expect(store.getMember('orphan-member')).toBeUndefined();
		expect(transitionEvents).toEqual([
			['membership:status_changed', 'membership:left'],
		]);
	});

	it('deletes offline session workers without membership after offline retention TTL', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		store.setMember({
			agentId: 'session-agent',
			agentName: 'session-agent',
			joinedAt: Date.now() - 20 * 60_000,
		});
		store.setWorker({
			agentId: 'session-agent',
			agentName: 'session-agent',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'offline' },
			lastSeenAt: Date.now() - 11 * 60_000,
		});

		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 3,
				type: 'member:leave',
				channel: 'control',
				payload: {
					agentId: 'session-agent',
				},
			}),
		);

		await host.runMaintenance();

		expect(store.getMember('session-agent')).toBeUndefined();
		expect(store.getWorker('session-agent')).toBeUndefined();
	});

	it('does not delete offline session workers with active accepted commitments', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({
			store,
			breachDetection: {
				enabled: true,
			},
		});
		const now = Date.now();

		store.setWorker({
			agentId: 'session-agent',
			agentName: 'Session Agent',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'offline' },
			lastSeenAt: now - 11 * 60_000,
		});
		store.setCommitment({
			commitmentId: 'commitment-1',
			taskId: 'task-1',
			assigneeId: 'session-agent',
			assigneeName: 'Session Agent',
			status: 'accepted',
			slaDeadline: now + 60_000,
			createdAt: now,
		});

		await host.runMaintenance();

		expect(store.getWorker('session-agent')).toEqual(
			expect.objectContaining({
				agentId: 'session-agent',
			}),
		);
	});
});
