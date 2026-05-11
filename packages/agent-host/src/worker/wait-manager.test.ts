import type { IProtocolEnvelope } from '@agent-group-lab/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { IWorkerClientPort } from '~/ports/worker-client-port';
import { WaitManager } from './wait-manager';

class FakeWorkerClientPort implements IWorkerClientPort {
	readonly sent: IProtocolEnvelope<string, unknown>[] = [];

	connect = async () => {};

	send = async (message: IProtocolEnvelope<string, unknown>) => {
		this.sent.push(message);
	};

	subscribe = () => {
		return () => {};
	};

	onDisconnect = () => {
		return () => {};
	};

	waitForMessage = async () => {
		throw new Error('not implemented');
	};

	close = async () => {};
}

const createEnvelope = (
	message: Omit<IProtocolEnvelope<string, unknown>, 'id' | 'seq' | 'ts' | 'v'>,
): IProtocolEnvelope<string, unknown> => {
	return {
		id: 'id',
		seq: 1,
		ts: Date.now(),
		v: 1,
		...message,
	};
};

const wait = async (ms: number) => {
	await new Promise((resolve) => setTimeout(resolve, ms));
};

describe('WaitManager', () => {
	it('fails fast after child task failure by re-syncing children status', async () => {
		const port = new FakeWorkerClientPort();
		const manager = new WaitManager({
			clientPort: port,
			createEnvelope,
			log: vi.fn(),
		});

		const pending = manager.startWaitForChildren({
			parentTaskId: 'task-parent',
			failFast: true,
		});
		await wait(1);
		await manager.handleTaskFailed({
			taskId: 'task-child',
			agentId: 'exec-1',
			agentName: 'exec-1',
			message: 'boom',
		});
		expect(port.sent.some((item) => item.type === 'task:children:status')).toBe(
			true,
		);

		await manager.handleChildrenStatusResult({
			requestId: 'req-1',
			parentTaskId: 'task-parent',
			recursive: false,
			summary: {
				total: 1,
				done: 0,
				cancelled: 1,
				inProgress: 0,
				todo: 0,
				blocked: 0,
			},
			allChildrenTerminal: true,
			allChildrenDone: false,
			children: [
				{
					taskId: 'task-child',
					depth: 1,
					status: 'cancelled',
					dependencies: [],
					failureMessage: 'boom',
				},
			],
		});

		await expect(pending).rejects.toThrow('children failed');
	});

	it('ignores stale children-completed event before recovering wait is aligned', async () => {
		const port = new FakeWorkerClientPort();
		const manager = new WaitManager({
			clientPort: port,
			createEnvelope,
			log: vi.fn(),
		});

		let resolved = false;
		const pending = manager
			.startWaitForChildren({
				parentTaskId: 'task-parent',
				failFast: true,
			})
			.then(() => {
				resolved = true;
			});
		await wait(1);

		manager.onDisconnect();
		manager.onReconnect(2);
		await manager.handleChildrenCompleted({
			parentTaskId: 'task-parent',
			parentAssigneeId: 'lead',
			parentAssigneeName: 'Lead',
			childTaskIds: ['task-child'],
		});
		await wait(1);
		expect(resolved).toBe(false);

		await manager.handleChildrenStatusResult({
			requestId: 'req-2',
			parentTaskId: 'task-parent',
			recursive: false,
			summary: {
				total: 1,
				done: 1,
				cancelled: 0,
				inProgress: 0,
				todo: 0,
				blocked: 0,
			},
			allChildrenTerminal: true,
			allChildrenDone: true,
			children: [
				{
					taskId: 'task-child',
					depth: 1,
					status: 'done',
					dependencies: [],
				},
			],
		});

		await pending;
		expect(resolved).toBe(true);
	});
});
