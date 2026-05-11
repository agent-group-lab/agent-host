import { describe, expect, it } from 'vitest';

import {
	canTransitionByMachine,
	createStatusMachine,
	createTransitionEvents,
} from './machine-adapter';

describe('machine-adapter', () => {
	it('checks transitions using xstate pure transition', () => {
		const machine = createStatusMachine(
			'test-machine',
			['idle', 'busy'] as const,
			{
				idle: ['busy'],
				busy: ['idle'],
			},
		);

		expect(canTransitionByMachine(machine, 'idle', 'busy')).toBe(true);
		expect(canTransitionByMachine(machine, 'busy', 'busy')).toBe(false);
	});

	it('creates base + alias transition events when rule matches', () => {
		const events = createTransitionEvents({
			aggregateType: 'task',
			aggregateId: 'task-1',
			fromState: 'assigned',
			toState: 'doing',
			trigger: 'doing',
		});

		expect(events.map((event) => event.eventType)).toEqual([
			'task:status_changed',
			'task:started',
		]);
	});

	it('creates membership transition events', () => {
		const events = createTransitionEvents({
			aggregateType: 'membership',
			aggregateId: 'agent-1',
			fromState: 'none',
			toState: 'joined',
			trigger: 'member:join',
		});

		expect(events.map((event) => event.eventType)).toEqual([
			'membership:status_changed',
			'membership:joined',
		]);
	});
});
