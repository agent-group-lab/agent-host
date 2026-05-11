import type { IHostWorkerRecord } from '@agent-group-lab/contracts/messages';
import { describe, expect, it } from 'vitest';
import { selectWorkerForTask } from './scheduler';

const createWorker = (
	overrides: Partial<IHostWorkerRecord> = {},
): IHostWorkerRecord => {
	return {
		agentId: overrides.agentId ?? 'worker-1',
		agentName: overrides.agentName ?? overrides.agentId ?? 'worker-1',
		connectionId: overrides.connectionId ?? 'conn-1',
		adapterId: overrides.adapterId ?? 'codex',
		workerType: overrides.workerType ?? 'persistent',
		capabilities: {
			streaming: true,
			toolUse: true,
			codeExecution: true,
			fileRead: true,
			fileWrite: true,
		},
		agentRole: overrides.agentRole ?? 'executor',
		workState: overrides.workState ?? { kind: 'idle' },
		lastSeenAt: overrides.lastSeenAt ?? Date.now(),
	};
};

describe('selectWorkerForTask', () => {
	it('picks first idle worker when no preferred worker is given', () => {
		const result = selectWorkerForTask({
			workers: [
				createWorker({
					agentId: 'worker-busy',
					workState: { kind: 'focused', taskId: 'task-1' },
				}),
				createWorker({ agentId: 'worker-idle', workState: { kind: 'idle' } }),
			],
		});

		expect(result.worker?.agentId).toBe('worker-idle');
	});

	it('returns retryable error when preferred worker is busy', () => {
		const result = selectWorkerForTask({
			workers: [
				createWorker({
					agentId: 'worker-1',
					workState: { kind: 'focused', taskId: 'task-1' },
				}),
			],
			requestedAgentId: 'worker-1',
		});

		expect(result.worker).toBeUndefined();
		expect(result.error).toContain('not idle');
	});

	it('filters by requiredRole when selecting default worker', () => {
		const result = selectWorkerForTask({
			workers: [
				createWorker({ agentId: 'worker-a', agentRole: 'executor' }),
				createWorker({ agentId: 'lead-a', agentRole: 'lead' }),
			],
			requiredRole: 'lead',
		});

		expect(result.worker?.agentId).toBe('lead-a');
	});

	it('returns error when no idle worker matches requiredRole', () => {
		const result = selectWorkerForTask({
			workers: [createWorker({ agentId: 'worker-a', agentRole: 'executor' })],
			requiredRole: 'lead',
		});

		expect(result.worker).toBeUndefined();
		expect(result.error).toContain('lead');
	});
});
