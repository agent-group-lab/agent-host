import { describe, expect, it } from 'vitest';
import { canTransitionInbox } from './inbox';

describe('canTransitionInbox', () => {
	it('allows valid transitions', () => {
		expect(canTransitionInbox('queued', 'reserved')).toBe(true);
		expect(canTransitionInbox('queued', 'dropped')).toBe(true);
		expect(canTransitionInbox('reserved', 'queued')).toBe(true);
		expect(canTransitionInbox('reserved', 'dispatched')).toBe(true);
		expect(canTransitionInbox('reserved', 'dropped')).toBe(true);
		expect(canTransitionInbox('dispatched', 'completed')).toBe(true);
		expect(canTransitionInbox('dispatched', 'dropped')).toBe(true);
	});

	it('rejects invalid transitions', () => {
		expect(canTransitionInbox('dropped', 'queued')).toBe(false);
		expect(canTransitionInbox('completed', 'queued')).toBe(false);
		expect(canTransitionInbox('completed', 'dropped')).toBe(false);
		expect(canTransitionInbox('queued', 'completed')).toBe(false);
		expect(canTransitionInbox('reserved', 'completed')).toBe(false);
		expect(canTransitionInbox('dispatched', 'queued')).toBe(false);
	});
});
