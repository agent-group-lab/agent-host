import type { IProtocolEnvelope } from '@agent-group-lab/protocol';
import { createEnvelope } from '@agent-group-lab/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { IHostPortConnection } from '~/ports/host-server-port';
import { InMemoryStore } from '~/store/in-memory-store';
import type { IConnectionMeta } from '~/store/store';
import { HostCore } from './host-core';

const createConnection = (
	id: string,
): IHostPortConnection & { sent: IProtocolEnvelope<string, unknown>[] } => {
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

describe('HostCore.rehydrateConnection', () => {
	it('restores live connection and preserves recovered metadata', () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const connection = createConnection('conn-1');
		const recoveredMeta: IConnectionMeta = {
			connectionId: 'conn-1',
			connectionRole: 'worker',
			agentId: 'worker-1',
			ready: true,
			connectedAt: 1234,
		};

		host.rehydrateConnection(connection, recoveredMeta);

		expect(store.getConnection('conn-1')).toEqual(recoveredMeta);
	});

	it('reuses persisted metadata when meta is omitted', () => {
		const store = new InMemoryStore();
		const persistedMeta: IConnectionMeta = {
			connectionId: 'conn-2',
			connectionRole: 'client',
			ready: true,
			connectedAt: 999,
		};
		store.setConnection(persistedMeta);
		const host = new HostCore({ store });
		const connection = createConnection('conn-2');

		host.rehydrateConnection(connection);

		expect(store.getConnection('conn-2')).toEqual(persistedMeta);
	});

	it('restores state machine to active when ready=true, allowing heartbeats without error', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const connection = createConnection('conn-3');
		const recoveredMeta: IConnectionMeta = {
			connectionId: 'conn-3',
			connectionRole: 'worker',
			agentId: 'worker-3',
			ready: true,
			connectedAt: 1234,
		};

		host.rehydrateConnection(connection, recoveredMeta);

		await host.handleMessage(
			connection,
			createEnvelope({
				seq: 1,
				type: 'control:heartbeat',
				channel: 'control',
				payload: { nonce: 'test-nonce' },
			}),
		);

		const sentTypes = connection.sent.map((m) => m.type);
		expect(sentTypes).not.toContain('control:error');
		expect(sentTypes).toContain('control:ack');
	});

	it('restores state machine to init when ready=false, rejecting heartbeats', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const connection = createConnection('conn-4');
		const recoveredMeta: IConnectionMeta = {
			connectionId: 'conn-4',
			connectionRole: 'unknown',
			ready: false,
			connectedAt: 1234,
		};

		host.rehydrateConnection(connection, recoveredMeta);

		await host.handleMessage(
			connection,
			createEnvelope({
				seq: 1,
				type: 'control:heartbeat',
				channel: 'control',
				payload: { nonce: 'test-nonce' },
			}),
		);

		const sentTypes = connection.sent.map((m) => m.type);
		expect(sentTypes).toContain('control:error');
	});

	it('restores session cursor to keep checkpoint continuity after resume', () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });

		host.restoreSessionCursor({
			sessionId: 'session_resumed',
			sessionStartedAt: 123456,
			timelineSeq: 42,
		});

		const checkpoint = host.checkpoint();
		expect(checkpoint.cursor.sessionId).toBe('session_resumed');
		expect(checkpoint.cursor.sessionStartedAt).toBe(123456);
		expect(checkpoint.cursor.timelineSeq).toBe(42);
	});
});
