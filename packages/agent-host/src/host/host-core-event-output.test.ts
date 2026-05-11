import type { ITransitionEvent } from '@agent-group-lab/contracts/events';
import type {
	AgentRole,
	IAgentEventPayload,
} from '@agent-group-lab/contracts/messages';
import type { ITimelineEntry } from '@agent-group-lab/contracts/timeline';
import type { IProtocolEnvelope } from '@agent-group-lab/protocol';
import { createEnvelope, PROTOCOL_VERSION } from '@agent-group-lab/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { IEventOutputPort } from '~/ports/event-output-port';
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

const collectEventTypes = (calls: Array<[ITransitionEvent[]]>) => {
	return calls.flatMap(([events]) => events.map((event) => event.eventType));
};

describe('HostCore event output port', () => {
	it('emits work transition events when worker registers', async () => {
		const store = new InMemoryStore();
		const onTransitionEvents = vi.fn<IEventOutputPort['onTransitionEvents']>();
		const host = new HostCore({
			store,
			eventOutputPort: {
				onTransitionEvents,
			},
		});
		const workerConn = createMockConnection('conn-worker-a');

		await registerWorker(host, workerConn, 'agent-a');

		const eventTypes = collectEventTypes(
			onTransitionEvents.mock.calls as Array<[ITransitionEvent[]]>,
		);
		expect(eventTypes).toContain('membership:status_changed');
		expect(eventTypes).toContain('membership:joined');
		expect(eventTypes).toContain('work:status_changed');
		expect(eventTypes).toContain('work:online');
	});

	it('emits task and commitment transition events for accept flow', async () => {
		const store = new InMemoryStore();
		const onTransitionEvents = vi.fn<IEventOutputPort['onTransitionEvents']>();
		const host = new HostCore({
			store,
			eventOutputPort: {
				onTransitionEvents,
			},
		});

		const workerConn = createMockConnection('conn-worker-a');
		await registerWorker(host, workerConn, 'agent-a');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 10,
				type: 'task:assign',
				channel: 'task:task-event',
				payload: {
					taskId: 'task-event',
					turnId: 'turn-event',
					prompt: 'do work',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);

		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 11,
				type: 'commitment:action',
				channel: 'task:task-event',
				payload: {
					taskId: 'task-event',
					action: 'ACCEPT',
				},
			}),
		);

		const eventTypes = collectEventTypes(
			onTransitionEvents.mock.calls as Array<[ITransitionEvent[]]>,
		);
		expect(eventTypes).toContain('task:status_changed');
		expect(eventTypes).toContain('commitment:status_changed');
	});

	it('emits ordered agent and transition timeline entries for agent events', async () => {
		const store = new InMemoryStore();
		const eventOrder: string[] = [];
		const timelineEntries: ITimelineEntry[] = [];
		const onTransitionEvents = vi.fn<IEventOutputPort['onTransitionEvents']>(
			(events) => {
				if (events.some((event) => event.eventType === 'work:status_changed')) {
					eventOrder.push('onTransitionEvents');
				}
			},
		);
		const onAgentEvent = vi.fn<NonNullable<IEventOutputPort['onAgentEvent']>>(
			(payload) => {
				if (payload?.event.type === 'tool:start') {
					eventOrder.push('onAgentEvent');
				}
			},
		);
		const onTimeline = vi.fn<NonNullable<IEventOutputPort['onTimeline']>>(
			(entry, _sessionStartedAt) => {
				if (!entry) {
					return;
				}
				timelineEntries.push(entry);
				eventOrder.push(`onTimeline:${entry.kind}`);
			},
		);
		const host = new HostCore({
			store,
			eventOutputPort: {
				onTransitionEvents,
				onAgentEvent,
				onTimeline,
			},
		});

		const workerConn = createMockConnection('conn-worker-a');
		await registerWorker(host, workerConn, 'agent-a');

		const clientConn = createMockConnection('conn-client');
		await makeReady(host, clientConn);
		await host.handleMessage(
			clientConn,
			createEnvelope({
				seq: 10,
				type: 'task:assign',
				channel: 'task:task-event',
				payload: {
					taskId: 'task-event',
					turnId: 'turn-event',
					prompt: 'do work',
					workingDirectory: '/tmp',
					agentId: 'agent-a',
				},
			}),
		);

		const worker = store.getWorker('agent-a');
		if (!worker) {
			throw new Error('Expected worker to be registered');
		}
		store.setWorker({
			...worker,
			workState: {
				kind: 'focused',
				taskId: 'task-event',
			},
		});
		eventOrder.length = 0;
		timelineEntries.length = 0;
		onTransitionEvents.mockClear();
		onAgentEvent.mockClear();
		onTimeline.mockClear();

		const payload: IAgentEventPayload = {
			taskId: 'task-event',
			agentId: 'agent-a',
			agentName: 'agent-a',
			event: {
				id: 'event-1',
				ts: Date.now(),
				turnId: 'turn-event',
				taskId: 'task-event',
				adapterId: 'adapter-test',
				type: 'tool:start',
				toolName: 'swarm-tools/ask_peer',
				args: {},
			},
		};
		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 11,
				type: 'agent:event',
				channel: 'task:task-event',
				payload,
			}),
		);

		expect(onAgentEvent).toHaveBeenCalledTimes(1);
		expect(onTransitionEvents).toHaveBeenCalledTimes(1);
		expect(timelineEntries).toHaveLength(2);
		expect(timelineEntries[0]?.kind).toBe('agent');
		expect(timelineEntries[1]?.kind).toBe('transition');
		expect(timelineEntries[0]?.sessionId).toBeDefined();
		expect(timelineEntries[1]?.sessionId).toBe(timelineEntries[0]?.sessionId);
		expect(timelineEntries[1]?.timelineSeq).toBe(
			(timelineEntries[0]?.timelineSeq ?? 0) + 1,
		);
		expect(eventOrder).toEqual([
			'onAgentEvent',
			'onTimeline:agent',
			'onTransitionEvents',
			'onTimeline:transition',
		]);
	});

	it('allows session-scoped agent events from matching session workers', async () => {
		const store = new InMemoryStore();
		const timelineEntries: ITimelineEntry[] = [];
		const host = new HostCore({
			store,
			eventOutputPort: {
				onTransitionEvents: () => {},
				onAgentEvent: () => {},
				onTimeline: (entry) => {
					timelineEntries.push(entry);
				},
			},
		});

		const workerConn = createMockConnection('conn-session-worker');
		await registerWorker(host, workerConn, 'agent-session');
		timelineEntries.length = 0;

		const payload: IAgentEventPayload = {
			taskId: 'session:agent-session:mcp-session-1',
			agentId: 'agent-session',
			agentName: 'agent-session',
			event: {
				id: 'event-session-1',
				ts: Date.now(),
				turnId: 'tool-call-1',
				taskId: 'session:agent-session:mcp-session-1',
				adapterId: 'agent-mcp',
				type: 'tool:done',
				toolName: 'swarm-tools/publish_claimable_tasks',
				output: '{}',
				isError: false,
				args: {
					nodes: [{ taskId: 'task-child' }],
				},
				relatedTaskIds: ['task-child'],
			},
		};

		await host.handleMessage(
			workerConn,
			createEnvelope({
				seq: 11,
				type: 'agent:event',
				channel: 'task:session:agent-session:mcp-session-1',
				payload,
			}),
		);

		expect(timelineEntries).toHaveLength(1);
		expect(timelineEntries[0]).toEqual(
			expect.objectContaining({
				kind: 'agent',
				agentEvent: payload,
			}),
		);
	});

	it('isolates onTimeline consumer errors from host flow', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({
			store,
			eventOutputPort: {
				onTransitionEvents: () => {},
				onTimeline: () => {
					throw new Error('timeline sink failure');
				},
			},
		});
		const workerConn = createMockConnection('conn-worker-a');

		await expect(registerWorker(host, workerConn, 'agent-a')).resolves.toBe(
			undefined,
		);
		expect(store.getWorker('agent-a')).toBeDefined();
	});

	it('isolates onTransitionEvents consumer errors from host flow', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({
			store,
			eventOutputPort: {
				onTransitionEvents: () => {
					throw new Error('transition sink failure');
				},
			},
		});
		const workerConn = createMockConnection('conn-worker-a');

		await expect(registerWorker(host, workerConn, 'agent-a')).resolves.toBe(
			undefined,
		);
		expect(store.getWorker('agent-a')).toBeDefined();
	});

	it('returns atomic snapshot and cursor through checkpoint()', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({
			store,
		});
		const workerConn = createMockConnection('conn-worker-a');
		await registerWorker(host, workerConn, 'agent-a');

		const checkpoint = host.checkpoint();
		expect(
			checkpoint.snapshot.workers.some((item) => item.agentId === 'agent-a'),
		).toBe(true);
		expect(checkpoint.cursor.sessionId).toBeDefined();
		expect(checkpoint.cursor.sessionStartedAt).toBeGreaterThan(0);
		expect(checkpoint.cursor.timelineSeq).toBeGreaterThan(0);
	});
});
