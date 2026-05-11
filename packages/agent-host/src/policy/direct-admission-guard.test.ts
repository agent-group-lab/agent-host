import { describe, expect, it } from 'vitest';
import { DirectAdmissionGuard } from './direct-admission-guard';

const createPayload = (overrides: Record<string, unknown> = {}) => {
	return {
		requestId: 'req-1',
		fromAgentId: 'agent-a',
		fromAgentName: 'Agent A',
		toAgentId: 'agent-b',
		toAgentName: 'Agent B',
		prompt: 'hello',
		workingDirectory: '/tmp',
		...overrides,
	};
};

const createContext = (overrides: Record<string, unknown> = {}) => {
	return {
		now: 2_000,
		messageTs: 1_000,
		senderRole: 'worker' as const,
		senderAgentId: 'agent-a',
		targetConnectionId: 'conn-b',
		queuedForTarget: 0,
		...overrides,
	};
};

describe('DirectAdmissionGuard', () => {
	it('allows valid request', () => {
		const guard = new DirectAdmissionGuard();
		const decision = guard.evaluate(createPayload(), createContext());
		expect(decision).toEqual({ allowed: true });
	});

	it('rejects worker identity mismatch', () => {
		const guard = new DirectAdmissionGuard();
		const decision = guard.evaluate(
			createPayload({ fromAgentId: 'agent-z' }),
			createContext(),
		);
		expect(decision.allowed).toBe(false);
		expect(decision.code).toBe('identity_mismatch');
	});

	it('rejects self direct', () => {
		const guard = new DirectAdmissionGuard();
		const decision = guard.evaluate(
			createPayload({ toAgentId: 'agent-a' }),
			createContext(),
		);
		expect(decision.allowed).toBe(false);
		expect(decision.code).toBe('self_direct');
	});

	it('rejects offline target', () => {
		const guard = new DirectAdmissionGuard();
		const decision = guard.evaluate(
			createPayload(),
			createContext({ targetConnectionId: undefined }),
		);
		expect(decision.allowed).toBe(false);
		expect(decision.reasonCode).toBe('target_offline');
	});

	it('rejects ttl expired', () => {
		const guard = new DirectAdmissionGuard();
		const decision = guard.evaluate(
			createPayload({ ttlMs: 100 }),
			createContext({ now: 2_000, messageTs: 1_000 }),
		);
		expect(decision.allowed).toBe(false);
		expect(decision.code).toBe('ttl_expired');
	});

	it('rejects queue full', () => {
		const guard = new DirectAdmissionGuard({ maxQueuedPerTarget: 1 });
		const decision = guard.evaluate(
			createPayload(),
			createContext({ queuedForTarget: 1 }),
		);
		expect(decision.allowed).toBe(false);
		expect(decision.reasonCode).toBe('queue_full');
	});

	it('rejects depth exceeded', () => {
		const guard = new DirectAdmissionGuard({ maxHops: 2 });
		const decision = guard.evaluate(
			createPayload({ hopCount: 3 }),
			createContext(),
		);
		expect(decision.allowed).toBe(false);
		expect(decision.reasonCode).toBe('depth_exceeded');
	});

	it('rejects loop detected', () => {
		const guard = new DirectAdmissionGuard();
		const decision = guard.evaluate(
			createPayload({ requestChain: ['agent-x', 'agent-b'] }),
			createContext(),
		);
		expect(decision.allowed).toBe(false);
		expect(decision.reasonCode).toBe('loop_detected');
	});

	it('rejects rate limited requests', () => {
		const guard = new DirectAdmissionGuard({
			rateLimitMaxRequestsPerWindow: 1,
			rateLimitWindowMs: 60_000,
		});
		const first = guard.evaluate(createPayload(), createContext());
		const second = guard.evaluate(
			createPayload({ requestId: 'req-2' }),
			createContext({ now: 2_001 }),
		);
		expect(first.allowed).toBe(true);
		expect(second.allowed).toBe(false);
		expect(second.reasonCode).toBe('rate_limited');
	});
});
