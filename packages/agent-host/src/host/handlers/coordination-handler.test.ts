import { describe, expect, it, vi } from 'vitest';
import { CoordinationHandler } from './coordination-handler';

const createContext = () => {
	return {
		meta: {
			connectionId: 'conn-1',
			connectionRole: 'worker',
			agentId: 'lead',
			ready: true,
			connectedAt: Date.now(),
		},
		live: {
			connection: {
				id: 'conn-1',
				send: vi.fn(async () => {}),
				close: vi.fn(async () => {}),
			},
		},
	};
};

describe('CoordinationHandler', () => {
	it('uses current worker task id when coord wait payload parent differs', async () => {
		const transitionWorkerState = vi.fn();
		const handler = new CoordinationHandler({
			sendProtocolError: vi.fn(async () => {}),
			transitionWorkerState,
			resolveCurrentTaskId: () => 'task-parent',
			log: vi.fn(),
		});

		await handler.handleCoordWaitStart(createContext() as never, {
			waitId: 'wait-1',
			parentTaskId: 'task-child',
		});

		expect(transitionWorkerState).toHaveBeenCalledWith('lead', {
			kind: 'waiting_delegation',
			taskId: 'task-parent',
			toolName: 'wait_for_children',
		});
	});

	it('falls back to payload parent task id when current worker task id is unavailable', async () => {
		const transitionWorkerState = vi.fn();
		const handler = new CoordinationHandler({
			sendProtocolError: vi.fn(async () => {}),
			transitionWorkerState,
			resolveCurrentTaskId: () => undefined,
			log: vi.fn(),
		});

		await handler.handleCoordWaitDone(createContext() as never, {
			waitId: 'wait-1',
			parentTaskId: 'task-parent',
			outcome: 'completed',
		});

		expect(transitionWorkerState).toHaveBeenCalledWith('lead', {
			kind: 'focused',
			taskId: 'task-parent',
		});
	});
});
