import { describe, expect, it } from 'vitest';
import type { WorkStateKind } from '~/domain/work-state';
import { type ITriageContext, type ITriageRule, RuleTriage } from './triage';

const createContext = (
	overrides: Partial<ITriageContext> = {},
): ITriageContext => ({
	toAgentId: overrides.toAgentId ?? 'agent-b',
	fromAgentId: overrides.fromAgentId ?? 'agent-a',
	requestId: overrides.requestId ?? 'req-1',
});

const createTriage = (workState: WorkStateKind, queuedCount = 0) => {
	return new RuleTriage({
		getWorkState: () => workState,
		getQueuedCount: () => queuedCount,
	});
};

describe('RuleTriage', () => {
	it('delivers when worker is idle', () => {
		const triage = createTriage('idle');
		const decision = triage.evaluate(createContext());
		expect(decision.action).toBe('deliver');
		expect(decision.ruleName).toBe('idle-deliver');
	});

	it('delivers when worker is finished', () => {
		const triage = createTriage('finished');
		const decision = triage.evaluate(createContext());
		expect(decision.action).toBe('deliver');
		expect(decision.ruleName).toBe('idle-deliver');
	});

	it('delivers when worker is blocked', () => {
		const triage = createTriage('blocked');
		const decision = triage.evaluate(createContext());
		expect(decision.action).toBe('deliver');
		expect(decision.ruleName).toBe('blocked-deliver');
	});

	it('defers when worker is focused', () => {
		const triage = createTriage('focused');
		const decision = triage.evaluate(createContext());
		expect(decision.action).toBe('defer');
		expect(decision.ruleName).toBe('busy-defer');
	});

	it('defers when worker is waiting_tool', () => {
		const triage = createTriage('waiting_tool');
		const decision = triage.evaluate(createContext());
		expect(decision.action).toBe('defer');
		expect(decision.ruleName).toBe('busy-defer');
	});

	it('defers when worker is waiting_delegation', () => {
		const triage = createTriage('waiting_delegation');
		const decision = triage.evaluate(createContext());
		expect(decision.action).toBe('defer');
		expect(decision.ruleName).toBe('busy-defer');
	});

	it('defers when worker is waiting_peer', () => {
		const triage = createTriage('waiting_peer');
		const decision = triage.evaluate(createContext());
		expect(decision.action).toBe('defer');
		expect(decision.ruleName).toBe('busy-defer');
	});

	it('defaults to defer when no rule matches', () => {
		const triage = createTriage('offline');
		const decision = triage.evaluate(createContext());
		expect(decision.action).toBe('defer');
		expect(decision.ruleName).toBe('default');
	});

	it('supports custom rules with priority ordering', () => {
		const customRule: ITriageRule = {
			name: 'always-drop',
			priority: 5,
			evaluate: () => 'drop',
		};

		const triage = new RuleTriage({
			rules: [customRule],
			getWorkState: () => 'idle',
			getQueuedCount: () => 0,
		});

		const decision = triage.evaluate(createContext());
		expect(decision.action).toBe('drop');
		expect(decision.ruleName).toBe('always-drop');
	});

	it('respects priority ordering of rules', () => {
		const lowPriority: ITriageRule = {
			name: 'low-deliver',
			priority: 100,
			evaluate: () => 'deliver',
		};
		const highPriority: ITriageRule = {
			name: 'high-drop',
			priority: 1,
			evaluate: () => 'drop',
		};

		const triage = new RuleTriage({
			rules: [lowPriority, highPriority],
			getWorkState: () => 'idle',
			getQueuedCount: () => 0,
		});

		const decision = triage.evaluate(createContext());
		expect(decision.action).toBe('drop');
		expect(decision.ruleName).toBe('high-drop');
	});
});
