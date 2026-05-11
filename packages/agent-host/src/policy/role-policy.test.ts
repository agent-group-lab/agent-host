import { describe, expect, it } from 'vitest';
import { getRolePolicy } from './role-policy';

describe('role-policy', () => {
	it('lead can assign but cannot execute tools', () => {
		const lead = getRolePolicy('lead');
		expect(lead.canAssignTasks).toBe(true);
		expect(lead.canExecuteTools).toBe(false);
		expect(lead.allowedActions.has('ACCEPT')).toBe(true);
		expect(lead.allowedActions.has('DEFER')).toBe(true);
	});

	it('executor can execute tools and assign', () => {
		const executor = getRolePolicy('executor');
		expect(executor.canExecuteTools).toBe(true);
		expect(executor.canAssignTasks).toBe(true);
		expect(executor.allowedActions.has('UPDATE')).toBe(true);
		expect(executor.allowedActions.has('ROUTE')).toBe(false);
	});

	it('reviewer can review but cannot execute tools/assign', () => {
		const reviewer = getRolePolicy('reviewer');
		expect(reviewer.canReviewDeliverables).toBe(true);
		expect(reviewer.canExecuteTools).toBe(false);
		expect(reviewer.canAssignTasks).toBe(false);
		expect(reviewer.allowedActions.has('DELIVER')).toBe(true);
		expect(reviewer.allowedActions.has('FAIL')).toBe(false);
	});
});
