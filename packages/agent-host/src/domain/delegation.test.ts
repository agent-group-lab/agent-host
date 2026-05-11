import { describe, expect, it } from 'vitest';
import {
	createDelegationRecord,
	transitionDelegation,
	transitionDelegationState,
} from './delegation';

describe('delegation', () => {
	it('creates delegation record and transitions to accepted/completed', () => {
		const delegation = createDelegationRecord(
			{
				delegationId: 'd-1',
				delegatorId: 'lead-a',
				delegateeId: 'executor-a',
				originalTaskId: 'task-root',
				delegatedTaskId: 'task-sub',
			},
			100,
		);
		expect(delegation.status).toBe('pending');
		expect(delegation.createdAt).toBe(100);

		const accepted = transitionDelegationState({
			delegation,
			nextStatus: 'accepted',
		});
		expect(accepted.status).toBe('accepted');

		const completed = transitionDelegationState({
			delegation: accepted,
			nextStatus: 'completed',
			at: 200,
		});
		expect(completed.status).toBe('completed');
		expect(completed.completedAt).toBe(200);
	});

	it('supports rejected transition', () => {
		const delegation = createDelegationRecord({
			delegationId: 'd-2',
			delegatorId: 'executor-a',
			delegateeId: 'executor-b',
			originalTaskId: 'task-a',
			delegatedTaskId: 'task-b',
		});
		const rejected = transitionDelegationState({
			delegation,
			nextStatus: 'rejected',
			at: 300,
		});
		expect(rejected.status).toBe('rejected');
		expect(rejected.completedAt).toBe(300);
	});

	it('rejects invalid transition', () => {
		const delegation = createDelegationRecord({
			delegationId: 'd-3',
			delegatorId: 'lead-a',
			delegateeId: 'executor-a',
			originalTaskId: 'task-a',
			delegatedTaskId: 'task-b',
		});
		expect(() => {
			transitionDelegationState({
				delegation,
				nextStatus: 'completed',
			});
		}).toThrowError('Invalid delegation transition');
	});

	it('produces transition events via new transition api', () => {
		const accepted = transitionDelegation({
			delegation: createDelegationRecord({
				delegationId: 'd-7',
				delegatorId: 'lead-a',
				delegateeId: 'executor-a',
				originalTaskId: 'task-a',
				delegatedTaskId: 'task-b',
			}),
			nextStatus: 'accepted',
			at: 10,
		});
		expect(accepted.domainEvents.map((event) => event.eventType)).toEqual([
			'delegation:status_changed',
			'delegation:accepted',
		]);
	});
});
