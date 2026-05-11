import { describe, expect, it } from 'vitest';
import { ProtocolError } from './errors';
import {
	ControlStateMachine,
	validateControlSequence,
	validateControlSequenceSafely,
} from './state-machine';

describe('control state machine', () => {
	it('accepts hello ready heartbeat flow', () => {
		const machine = new ControlStateMachine();

		machine.apply('control:hello');
		machine.apply('control:ready');
		const transition = machine.apply('control:heartbeat');

		expect(machine.getState()).toBe('active');
		expect(transition.lifecycleEvent?.type).toBe('heartbeat');
	});

	it('rejects invalid transition', () => {
		const machine = new ControlStateMachine();

		expect(() => {
			machine.apply('control:ack');
		}).toThrow(ProtocolError);
	});

	it('can reconnect and continue', () => {
		const machine = new ControlStateMachine();
		machine.apply('control:hello');
		machine.apply('control:ready');
		machine.apply('control:heartbeat');

		const reconnectEvent = machine.markReconnect('socket dropped');

		expect(reconnectEvent.type).toBe('reconnect');
		expect(machine.getState()).toBe('init');
		machine.apply('control:hello');
		expect(machine.getState()).toBe('hello');
	});
});

describe('control sequence helpers', () => {
	it('validates sequence and returns ending state', () => {
		const state = validateControlSequence([
			'control:hello',
			'control:ready',
			'control:events-since',
		]);

		expect(state).toBe('active');
	});

	it('returns safe parse style failure when invalid', () => {
		const result = validateControlSequenceSafely(['control:ready']);

		expect(result.success).toBe(false);
		if (result.success) {
			throw new Error('Expected failure result');
		}
		expect(result.payload.code).toBe('protocol');
	});
});
