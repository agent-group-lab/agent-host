import { createEnvelope, PROTOCOL_VERSION } from '@agent-group-lab/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { IHostPortConnection } from '~/ports/host-server-port';
import { InMemoryStore } from '~/store/in-memory-store';
import { HostCore } from '../host-core';

const createMockConnection = (
	id: string,
): IHostPortConnection & { sent: unknown[] } => {
	const sent: unknown[] = [];
	return {
		id,
		sent,
		send: vi.fn(async (message) => {
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

describe('WorkerRegistryHandler', () => {
	it('registers a session worker without a push connection id', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const conn = createMockConnection('conn-session');

		await makeReady(host, conn);
		await host.handleMessage(
			conn,
			createEnvelope({
				seq: 2,
				type: 'worker:register',
				channel: 'control',
				payload: {
					agentId: 'agent-1',
					agentName: 'Agent 1',
					workerType: 'session',
					adapterId: undefined,
					capabilities: {
						streaming: false,
						toolUse: true,
						codeExecution: false,
						fileRead: false,
						fileWrite: false,
					},
					role: 'executor',
				},
			}),
		);

		expect(store.getWorker('agent-1')).toEqual(
			expect.objectContaining({
				agentId: 'agent-1',
				agentName: 'Agent 1',
				connectionId: undefined,
				adapterId: undefined,
				workerType: 'session',
				workState: { kind: 'idle' },
			}),
		);
		expect(store.getMember('agent-1')).toEqual(
			expect.objectContaining({
				agentId: 'agent-1',
				agentName: 'Agent 1',
			}),
		);
	});

	it('registers a persistent worker with its live connection id', async () => {
		const store = new InMemoryStore();
		const host = new HostCore({ store });
		const conn = createMockConnection('conn-persistent');

		await makeReady(host, conn);
		await host.handleMessage(
			conn,
			createEnvelope({
				seq: 2,
				type: 'worker:register',
				channel: 'control',
				payload: {
					agentId: 'agent-1',
					agentName: 'Agent 1',
					workerType: 'persistent',
					adapterId: 'codex',
					capabilities: {
						streaming: true,
						toolUse: true,
						codeExecution: true,
						fileRead: true,
						fileWrite: true,
					},
					role: 'executor',
				},
			}),
		);

		expect(store.getWorker('agent-1')).toEqual(
			expect.objectContaining({
				agentId: 'agent-1',
				connectionId: 'conn-persistent',
				adapterId: 'codex',
				workerType: 'persistent',
				workState: { kind: 'idle' },
			}),
		);
	});
});
