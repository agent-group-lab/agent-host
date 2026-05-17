import type { AddressInfo } from 'node:net';
import { createEnvelope } from '@agent-group-lab/protocol';
import { describe, expect, it } from 'vitest';
import { WebSocketClient } from './websocket-client';
import { WebSocketHostServer } from './websocket-server';

describe('WebSocketHostServer', () => {
	it('accepts websocket clients and exchanges protocol frames', async () => {
		const server = new WebSocketHostServer({
			host: '127.0.0.1',
			port: 0,
		});
		const receivedMessage = new Promise<unknown>((resolve) => {
			server.onMessage(async (connection, message) => {
				resolve(message);
				await connection.send(
					createEnvelope({
						channel: 'control',
						payload: { ok: true },
						seq: 2,
						type: 'test:reply',
					}),
				);
			});
		});

		await server.start();
		const address = server.address() as AddressInfo;
		const client = new WebSocketClient({
			wsUrl: `ws://127.0.0.1:${address.port}`,
		});

		try {
			await client.connect();
			await client.send(
				createEnvelope({
					channel: 'control',
					payload: { value: 42 },
					seq: 1,
					type: 'test:message',
				}),
			);

			await expect(receivedMessage).resolves.toMatchObject({
				payload: { value: 42 },
				type: 'test:message',
			});
			await expect(
				client.waitForMessage((message) => message.type === 'test:reply', 1000),
			).resolves.toMatchObject({
				payload: { ok: true },
				type: 'test:reply',
			});
		} finally {
			await client.close();
			await server.stop();
		}
	});
});
