import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { startHostService } from './host-service';

vi.mock('~/transport/websocket/websocket-server', () => {
	class MockWebSocketHostServer {
		onConnection = () => {};
		onMessage = () => {};
		onDisconnect = () => {};
		onError = () => {};
		start = async () => {};
		stop = async () => {};
	}
	return {
		WebSocketHostServer: MockWebSocketHostServer,
	};
});

describe('startHostService', () => {
	it('exposes atomic checkpoint with snapshot and cursor', async () => {
		const tempDir = await mkdtemp(join(tmpdir(), 'swarm-host-test-'));
		const runtime = await startHostService({
			port: 0,
			storeDir: tempDir,
		});

		try {
			const checkpoint = runtime.checkpoint();
			expect(checkpoint.snapshot).toBeDefined();
			expect(checkpoint.cursor.sessionId.length).toBeGreaterThan(0);
			expect(checkpoint.cursor.sessionStartedAt).toBeGreaterThan(0);
			expect(checkpoint.cursor.timelineSeq).toBeGreaterThanOrEqual(0);
		} finally {
			await runtime.close();
			await runtime.waitUntilClosed();
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});
