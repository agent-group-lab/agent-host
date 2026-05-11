import { describe, expect, it } from 'vitest';
import { createDirectInboxWorkRef, type IInboxAddInput } from '~/domain/inbox';
import { InMemoryStore } from '~/store/in-memory-store';
import { StoreBackedInbox } from './inbox';

const createInput = (
	overrides: Partial<IInboxAddInput> = {},
): IInboxAddInput => ({
	entryId: overrides.entryId ?? 'entry-1',
	toAgentId: overrides.toAgentId ?? 'agent-b',
	toAgentName: overrides.toAgentName ?? 'agent-b',
	fromAgentId: overrides.fromAgentId ?? 'agent-a',
	fromAgentName: overrides.fromAgentName ?? 'agent-b',
	requestId: overrides.requestId ?? 'req-1',
	work: overrides.work,
	payload: overrides.payload ?? { prompt: 'hello' },
});

describe('StoreBackedInbox', () => {
	it('adds entries with queued status and default direct work ref', () => {
		const store = new InMemoryStore();
		const inbox = new StoreBackedInbox(store);

		const entry = inbox.add(createInput());
		expect(entry.status).toBe('queued');
		expect(entry.entryId).toBe('entry-1');
		expect(entry.toAgentId).toBe('agent-b');
		expect(entry.fromAgentId).toBe('agent-a');
		expect(entry.requestId).toBe('req-1');
		expect(entry.work.workKind).toBe('direct');
		expect(entry.work.workId).toBe('req-1');
		expect(entry.work.targetAgentId).toBe('agent-b');
		expect(entry.work.sourceAgentId).toBe('agent-a');
		expect(entry.work.priority).toBe(0);

		expect(store.getInboxEntry('entry-1')).toEqual(entry);
	});

	it('accepts custom work ref at add time', () => {
		const store = new InMemoryStore();
		const inbox = new StoreBackedInbox(store);

		const entry = inbox.add(
			createInput({
				work: {
					workId: 'task-1',
					workKind: 'task',
					targetAgentId: 'agent-b',
					sourceAgentId: 'client-1',
					priority: 5,
					payloadRef: { taskId: 'task-1' },
				},
			}),
		);
		expect(entry.work.workKind).toBe('task');
		expect(entry.work.priority).toBe(5);
		if (entry.work.workKind === 'task') {
			expect(entry.work.payloadRef.taskId).toBe('task-1');
		}
	});

	it('transitions entries through valid states', () => {
		const store = new InMemoryStore();
		const inbox = new StoreBackedInbox(store);

		inbox.add(createInput());
		const reserved = inbox.transition('entry-1', 'reserved');
		expect(reserved.status).toBe('reserved');

		const dispatched = inbox.transition('entry-1', 'dispatched');
		expect(dispatched.status).toBe('dispatched');

		const completed = inbox.transition('entry-1', 'completed');
		expect(completed.status).toBe('completed');
	});

	it('throws on invalid transition', () => {
		const store = new InMemoryStore();
		const inbox = new StoreBackedInbox(store);

		inbox.add(createInput());
		inbox.transition('entry-1', 'dropped');

		expect(() => inbox.transition('entry-1', 'queued')).toThrow(
			'Invalid inbox transition: dropped -> queued',
		);
	});

	it('throws on non-existent entry', () => {
		const store = new InMemoryStore();
		const inbox = new StoreBackedInbox(store);

		expect(() => inbox.transition('nope', 'queued')).toThrow(
			'Inbox entry nope not found',
		);
	});

	it('getByAgent filters by agent and status', () => {
		const store = new InMemoryStore();
		const inbox = new StoreBackedInbox(store);

		inbox.add(
			createInput({ entryId: 'e1', toAgentId: 'agent-b', requestId: 'r1' }),
		);
		inbox.add(
			createInput({ entryId: 'e2', toAgentId: 'agent-b', requestId: 'r2' }),
		);
		inbox.add(
			createInput({ entryId: 'e3', toAgentId: 'agent-c', requestId: 'r3' }),
		);

		inbox.transition('e1', 'reserved');

		expect(inbox.getByAgent('agent-b')).toHaveLength(2);
		expect(inbox.getByAgent('agent-b', { status: 'queued' })).toHaveLength(1);
		expect(inbox.getByAgent('agent-b', { status: 'reserved' })).toHaveLength(1);
		expect(inbox.getByAgent('agent-c')).toHaveLength(1);
	});

	it('getDispatchCandidates returns queued candidates ordered by priority then createdAt', () => {
		const store = new InMemoryStore();
		const inbox = new StoreBackedInbox(store);

		inbox.add(
			createInput({
				entryId: 'e1',
				requestId: 'r1',
				work: createDirectInboxWorkRef({
					toAgentId: 'agent-b',
					fromAgentId: 'agent-a',
					requestId: 'r1',
					priority: 1,
				}),
			}),
		);
		inbox.add(
			createInput({
				entryId: 'e2',
				requestId: 'r2',
				work: createDirectInboxWorkRef({
					toAgentId: 'agent-b',
					fromAgentId: 'agent-a',
					requestId: 'r2',
					priority: 5,
				}),
			}),
		);
		inbox.add(
			createInput({
				entryId: 'e3',
				requestId: 'r3',
				work: createDirectInboxWorkRef({
					toAgentId: 'agent-b',
					fromAgentId: 'agent-a',
					requestId: 'r3',
					priority: 5,
				}),
			}),
		);
		inbox.transition('e1', 'reserved');

		const candidates = inbox.getDispatchCandidates('agent-b');
		expect(candidates).toHaveLength(2);
		expect(candidates[0]?.entryId).toBe('e2');
		expect(candidates[1]?.entryId).toBe('e3');
	});

	it('getQueued returns queued candidates for compatibility', () => {
		const store = new InMemoryStore();
		const inbox = new StoreBackedInbox(store);

		inbox.add(createInput({ entryId: 'e1', requestId: 'r1' }));
		inbox.add(createInput({ entryId: 'e2', requestId: 'r2' }));
		inbox.transition('e1', 'reserved');

		const queued = inbox.getDispatchCandidates('agent-b');
		expect(queued).toHaveLength(1);
		expect(queued[0]?.entryId).toBe('e2');
	});

	it('dequeue returns top queued candidate', () => {
		const store = new InMemoryStore();
		const inbox = new StoreBackedInbox(store);

		inbox.add(createInput({ entryId: 'e1', requestId: 'r1' }));
		inbox.add(
			createInput({
				entryId: 'e2',
				requestId: 'r2',
				work: createDirectInboxWorkRef({
					toAgentId: 'agent-b',
					fromAgentId: 'agent-a',
					requestId: 'r2',
					priority: 3,
				}),
			}),
		);

		const next = inbox.dequeue('agent-b');
		expect(next?.entryId).toBe('e2');
	});

	it('dequeue returns undefined when no queued entries', () => {
		const store = new InMemoryStore();
		const inbox = new StoreBackedInbox(store);

		expect(inbox.dequeue('agent-b')).toBeUndefined();
	});

	it('get retrieves entry by id', () => {
		const store = new InMemoryStore();
		const inbox = new StoreBackedInbox(store);

		const added = inbox.add(createInput());
		expect(inbox.get('entry-1')).toEqual(added);
		expect(inbox.get('nope')).toBeUndefined();
	});

	it('findByRequestId performs idempotency check', () => {
		const store = new InMemoryStore();
		const inbox = new StoreBackedInbox(store);

		inbox.add(createInput());
		expect(inbox.findByRequestId('agent-b', 'req-1')?.entryId).toBe('entry-1');
		expect(inbox.findByRequestId('agent-b', 'req-999')).toBeUndefined();
		expect(inbox.findByRequestId('agent-x', 'req-1')).toBeUndefined();
	});

	it('persists through store snapshot/restore', () => {
		const store = new InMemoryStore();
		const inbox = new StoreBackedInbox(store);

		inbox.add(createInput());

		const snapshot = store.snapshot();
		const restored = new InMemoryStore();
		restored.restore(snapshot);
		const restoredInbox = new StoreBackedInbox(restored);

		expect(restoredInbox.get('entry-1')?.status).toBe('queued');
		expect(restoredInbox.getDispatchCandidates('agent-b')).toHaveLength(1);
		expect(restoredInbox.get('entry-1')?.work.workKind).toBe('direct');
	});
});
