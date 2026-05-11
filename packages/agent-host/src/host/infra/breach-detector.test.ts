import { describe, expect, it, vi } from 'vitest';
import { createCommitmentRecord } from '~/domain/commitment';
import { InMemoryStore } from '~/store/in-memory-store';
import { BreachDetector } from './breach-detector';

describe('breach-detector', () => {
	it('detects overdue accepted commitments only', async () => {
		const store = new InMemoryStore();
		const onBreach = vi.fn(async () => {});
		const detector = new BreachDetector({
			store,
			onBreach,
			now: () => 1_000,
		});

		const overdue = {
			...createCommitmentRecord({
				commitmentId: 'c-overdue',
				taskId: 'task-1',
				assigneeId: 'agent-a',
				slaDeadline: 900,
			}),
			status: 'accepted' as const,
			acceptedAt: 100,
		};
		const inTime = {
			...createCommitmentRecord({
				commitmentId: 'c-intime',
				taskId: 'task-2',
				assigneeId: 'agent-b',
				slaDeadline: 1_100,
			}),
			status: 'accepted' as const,
			acceptedAt: 200,
		};
		const done = {
			...createCommitmentRecord({
				commitmentId: 'c-done',
				taskId: 'task-3',
				assigneeId: 'agent-c',
				slaDeadline: 800,
			}),
			status: 'delivered' as const,
			resolvedAt: 500,
		};

		store.setCommitment(overdue);
		store.setCommitment(inTime);
		store.setCommitment(done);

		await detector.scanOnce();
		expect(onBreach).toHaveBeenCalledTimes(1);
		expect(onBreach).toHaveBeenCalledWith(overdue);
	});
});
