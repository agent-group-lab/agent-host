import { describe, expect, it } from 'vitest';
import {
	canTransitionWork,
	createInitialWorkState,
	getTaskIdFromWorkState,
	transitionWork,
	transitionWorkState,
	type WorkState,
} from './work-state';

describe('work-state', () => {
	it('supports legal transitions', () => {
		expect(canTransitionWork('offline', 'idle')).toBe(true);
		expect(canTransitionWork('idle', 'focused')).toBe(true);
		expect(canTransitionWork('focused', 'waiting_tool')).toBe(true);
		expect(canTransitionWork('focused', 'waiting_delegation')).toBe(true);
		expect(canTransitionWork('focused', 'waiting_peer')).toBe(true);
		expect(canTransitionWork('waiting_tool', 'focused')).toBe(true);
		expect(canTransitionWork('waiting_tool', 'waiting_delegation')).toBe(true);
		expect(canTransitionWork('waiting_delegation', 'focused')).toBe(true);
		expect(canTransitionWork('waiting_peer', 'focused')).toBe(true);
		expect(canTransitionWork('focused', 'finished')).toBe(true);
		expect(canTransitionWork('finished', 'idle')).toBe(true);
	});

	it('rejects illegal transitions', () => {
		expect(canTransitionWork('offline', 'focused')).toBe(false);
		expect(canTransitionWork('idle', 'finished')).toBe(false);
		expect(canTransitionWork('finished', 'offline')).toBe(false);
	});

	it('throws on invalid transition', () => {
		const current: WorkState = { kind: 'idle' };
		expect(() =>
			transitionWorkState(current, { kind: 'finished', taskId: 'task-1' }),
		).toThrowError('Invalid work state transition');
	});

	it('creates initial state', () => {
		expect(createInitialWorkState()).toEqual({ kind: 'offline' });
		expect(createInitialWorkState('idle')).toEqual({ kind: 'idle' });
	});

	it('extracts taskId from task-carrying states', () => {
		expect(getTaskIdFromWorkState({ kind: 'idle' })).toBeUndefined();
		expect(getTaskIdFromWorkState({ kind: 'focused', taskId: 'task-1' })).toBe(
			'task-1',
		);
		expect(
			getTaskIdFromWorkState({ kind: 'waiting_tool', taskId: 'task-2' }),
		).toBe('task-2');
		expect(
			getTaskIdFromWorkState({
				kind: 'waiting_delegation',
				taskId: 'task-2-delegation',
			}),
		).toBe('task-2-delegation');
		expect(
			getTaskIdFromWorkState({
				kind: 'waiting_peer',
				taskId: 'task-3',
				requestId: 'req-3',
				toAgentId: 'agent-b',
			}),
		).toBe('task-3');
	});

	it('round-trips through json serialization', () => {
		const input: WorkState = {
			kind: 'blocked',
			taskId: 'task-1',
			reason: 'awaiting approval',
		};

		const parsed = JSON.parse(JSON.stringify(input)) as WorkState;
		expect(parsed).toEqual(input);
		expect(parsed.kind).toBe('blocked');
	});

	it('produces transition events via new transition api', () => {
		const current: WorkState = { kind: 'offline' };
		const next: WorkState = { kind: 'idle' };
		const result = transitionWork({
			current,
			next,
			aggregateId: 'worker-1',
			occurredAt: 10,
		});

		expect(result.domainEvents.map((event) => event.eventType)).toEqual([
			'work:status_changed',
			'work:online',
		]);
	});
});
