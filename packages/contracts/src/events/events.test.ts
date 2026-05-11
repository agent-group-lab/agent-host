import { describe, expect, it } from 'vitest';

import { resolveSemanticAlias, semanticAliasMap } from './semantic-aliases';
import { transitionEventSchema } from './transition-event';

describe('event contracts', () => {
	it('defines semantic aliases for all required aggregates', () => {
		expect(semanticAliasMap['membership:status_changed']).toBeDefined();
		expect(semanticAliasMap['task:status_changed']).toBeDefined();
		expect(semanticAliasMap['work:status_changed']).toBeDefined();
		expect(semanticAliasMap['commitment:status_changed']).toBeDefined();
		expect(semanticAliasMap['delegation:status_changed']).toBeDefined();
	});

	it('resolves aliases by transition states', () => {
		expect(
			resolveSemanticAlias('membership:status_changed', 'none', 'joined')
				?.alias,
		).toBe('membership:joined');
		expect(
			resolveSemanticAlias('membership:status_changed', 'joined', 'none')
				?.alias,
		).toBe('membership:left');
		expect(
			resolveSemanticAlias('task:status_changed', 'todo', 'assigned')?.alias,
		).toBe('task:assigned');
		expect(
			resolveSemanticAlias('task:status_changed', 'assigned', 'doing')?.alias,
		).toBe('task:started');
		expect(
			resolveSemanticAlias('commitment:status_changed', 'none', 'accepted')
				?.alias,
		).toBe('commitment:accepted');
		expect(
			resolveSemanticAlias('work:status_changed', 'idle', 'finished')?.alias,
		).toBe('work:finished');
		expect(
			resolveSemanticAlias('inbox:status_changed', 'queued', 'reserved'),
		).toBe(undefined);
	});

	it('validates transition event shape', () => {
		const parsed = transitionEventSchema.safeParse({
			eventId: 'evt_1',
			eventType: 'membership:status_changed',
			aggregateType: 'membership',
			aggregateId: 'agent_1',
			fromState: 'none',
			toState: 'joined',
			trigger: 'member:join',
			occurredAt: Date.now(),
			actor: 'worker-1',
			correlationId: 'corr-1',
			causationId: 'cause-1',
		});
		expect(parsed.success).toBe(true);
	});
});
