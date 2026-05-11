import { describe, expect, it } from 'vitest';
import {
	createCommitmentRecord,
	isCommitmentTerminal,
	transitionCommitment,
	transitionCommitmentState,
	updateCommitmentProgress,
} from './commitment';

describe('commitment', () => {
	it('creates commitment and transitions none -> accepted', () => {
		const commitment = createCommitmentRecord(
			{
				commitmentId: 'c-1',
				taskId: 'task-1',
				assigneeId: 'agent-a',
				deliverableSpec: 'summary report',
			},
			100,
		);
		expect(commitment.status).toBe('none');
		expect(commitment.createdAt).toBe(100);
		expect(commitment.deliveredRequestId).toBeUndefined();

		const accepted = transitionCommitmentState({
			commitment,
			nextStatus: 'accepted',
			at: 200,
		});
		expect(commitment.status).toBe('none');
		expect(accepted.status).toBe('accepted');
		expect(accepted.acceptedAt).toBe(200);
	});

	it('transitions accepted -> delivered with artifact and deliveredRequestId', () => {
		const accepted = transitionCommitmentState({
			commitment: createCommitmentRecord({
				commitmentId: 'c-2',
				taskId: 'task-2',
				assigneeId: 'agent-b',
			}),
			nextStatus: 'accepted',
			at: 10,
		});
		const delivered = transitionCommitmentState({
			commitment: accepted,
			nextStatus: 'delivered',
			at: 20,
			artifact: { file: 'report.md' },
			deliveredRequestId: 'req-1',
		});
		expect(delivered.status).toBe('delivered');
		expect(delivered.resolvedAt).toBe(20);
		expect(delivered.artifact).toEqual({ file: 'report.md' });
		expect(delivered.deliveredRequestId).toBe('req-1');
		expect(isCommitmentTerminal(delivered.status)).toBe(true);
	});

	it('transitions accepted -> failed/breached with reason', () => {
		const accepted = transitionCommitmentState({
			commitment: createCommitmentRecord({
				commitmentId: 'c-3',
				taskId: 'task-3',
				assigneeId: 'agent-c',
			}),
			nextStatus: 'accepted',
			at: 10,
		});
		const failed = transitionCommitmentState({
			commitment: accepted,
			nextStatus: 'failed',
			at: 20,
			failureReason: 'tool failed',
		});
		expect(failed.status).toBe('failed');
		expect(failed.failureReason).toBe('tool failed');
		expect(failed.resolvedAt).toBe(20);

		const accepted2 = transitionCommitmentState({
			commitment: createCommitmentRecord({
				commitmentId: 'c-4',
				taskId: 'task-4',
				assigneeId: 'agent-d',
			}),
			nextStatus: 'accepted',
			at: 10,
		});
		const breached = transitionCommitmentState({
			commitment: accepted2,
			nextStatus: 'breached',
			at: 30,
			failureReason: 'sla timeout',
		});
		expect(breached.status).toBe('breached');
		expect(breached.failureReason).toBe('sla timeout');
		expect(breached.resolvedAt).toBe(30);
	});

	it('updates progress without status transition', () => {
		const accepted = transitionCommitmentState({
			commitment: createCommitmentRecord({
				commitmentId: 'c-5',
				taskId: 'task-5',
				assigneeId: 'agent-e',
			}),
			nextStatus: 'accepted',
		});
		const withProgress = updateCommitmentProgress({
			commitment: accepted,
			progress: '50%',
		});
		expect(withProgress.status).toBe('accepted');
		expect(withProgress.progress).toBe('50%');
		expect(accepted.progress).toBeUndefined();
	});

	it('throws on invalid transition and terminal re-transition', () => {
		const commitment = createCommitmentRecord({
			commitmentId: 'c-6',
			taskId: 'task-6',
			assigneeId: 'agent-f',
		});
		expect(() => {
			transitionCommitmentState({
				commitment,
				nextStatus: 'delivered',
			});
		}).toThrowError('Invalid commitment transition');

		const delivered = transitionCommitmentState({
			commitment: transitionCommitmentState({
				commitment,
				nextStatus: 'accepted',
			}),
			nextStatus: 'delivered',
		});
		expect(() => {
			transitionCommitmentState({
				commitment: delivered,
				nextStatus: 'failed',
			});
		}).toThrowError('Invalid commitment transition');
	});

	it('produces transition events via new transition api', () => {
		const accepted = transitionCommitment({
			commitment: createCommitmentRecord({
				commitmentId: 'c-7',
				taskId: 'task-7',
				assigneeId: 'agent-g',
			}),
			nextStatus: 'accepted',
			at: 10,
		});
		expect(accepted.changed).toBe(true);
		expect(accepted.domainEvents.map((event) => event.eventType)).toEqual([
			'commitment:status_changed',
			'commitment:accepted',
		]);

		const delivered = transitionCommitment({
			commitment: accepted.state,
			nextStatus: 'delivered',
			at: 20,
			artifact: { file: 'out.md' },
			deliveredRequestId: 'req-2',
		});
		expect(delivered.domainEvents.map((event) => event.eventType)).toEqual([
			'commitment:status_changed',
			'commitment:delivered',
		]);
		expect(delivered.state.deliveredRequestId).toBe('req-2');
	});

	it('clears stale deliveredRequestId when transitioning into accepted', () => {
		const pending = {
			...createCommitmentRecord({
				commitmentId: 'c-8',
				taskId: 'task-8',
				assigneeId: 'agent-h',
			}),
			deliveredRequestId: 'old-req',
		};

		const accepted = transitionCommitmentState({
			commitment: pending,
			nextStatus: 'accepted',
			at: 20,
		});

		expect(accepted.deliveredRequestId).toBeUndefined();
		expect(accepted.acceptedAt).toBe(20);
	});
});
