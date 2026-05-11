import type { IHostWorkerRecord } from '@agent-group-lab/contracts/messages';
import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '~/store/in-memory-store';
import { StoreBackedMailbox } from './mailbox';

const createWorker = (
	overrides: Partial<IHostWorkerRecord> = {},
): IHostWorkerRecord => ({
	agentId: overrides.agentId ?? 'worker-1',
	agentName: overrides.agentName ?? overrides.agentId ?? 'worker-1',
	connectionId: 'connectionId' in overrides ? overrides.connectionId : 'conn-1',
	workerType: overrides.workerType ?? 'persistent',
	adapterId: overrides.adapterId ?? 'codex',
	capabilities: {
		streaming: true,
		toolUse: true,
		codeExecution: true,
		fileRead: true,
		fileWrite: true,
	},
	agentRole: overrides.agentRole ?? 'executor',
	workState: overrides.workState ?? { kind: 'idle' },
	lastSeenAt: overrides.lastSeenAt ?? Date.now(),
});

describe('StoreBackedMailbox', () => {
	it('resolves online worker to connectionId', () => {
		const store = new InMemoryStore();
		store.setWorker(createWorker());
		const mailbox = new StoreBackedMailbox(store);

		expect(mailbox.resolve('worker-1')).toBe('conn-1');
	});

	it('resolves offline worker to undefined', () => {
		const store = new InMemoryStore();
		store.setWorker(createWorker({ workState: { kind: 'offline' } }));
		const mailbox = new StoreBackedMailbox(store);

		expect(mailbox.resolve('worker-1')).toBeUndefined();
	});

	it('resolves non-existent worker to undefined', () => {
		const store = new InMemoryStore();
		const mailbox = new StoreBackedMailbox(store);

		expect(mailbox.resolve('nope')).toBeUndefined();
	});

	it('isOnline returns true for online worker', () => {
		const store = new InMemoryStore();
		store.setWorker(createWorker());
		const mailbox = new StoreBackedMailbox(store);

		expect(mailbox.isOnline('worker-1')).toBe(true);
	});

	it('isOnline returns false for offline worker', () => {
		const store = new InMemoryStore();
		store.setWorker(createWorker({ workState: { kind: 'offline' } }));
		const mailbox = new StoreBackedMailbox(store);

		expect(mailbox.isOnline('worker-1')).toBe(false);
	});

	it('isOnline returns false for non-existent worker', () => {
		const store = new InMemoryStore();
		const mailbox = new StoreBackedMailbox(store);

		expect(mailbox.isOnline('nope')).toBe(false);
	});

	it('resolves focused worker to connectionId', () => {
		const store = new InMemoryStore();
		store.setWorker(
			createWorker({
				workState: { kind: 'focused', taskId: 'task-1' },
				connectionId: 'conn-busy',
			}),
		);
		const mailbox = new StoreBackedMailbox(store);

		expect(mailbox.resolve('worker-1')).toBe('conn-busy');
	});

	it('treats session worker as online without a pushable connection', () => {
		const store = new InMemoryStore();
		store.setWorker(
			createWorker({
				workerType: 'session',
				connectionId: undefined,
				workState: { kind: 'focused', taskId: 'task-1' },
			}),
		);
		const mailbox = new StoreBackedMailbox(store);

		expect(mailbox.resolve('worker-1')).toBeUndefined();
		expect(mailbox.isOnline('worker-1')).toBe(true);
	});

	it('treats offline session worker as not online', () => {
		const store = new InMemoryStore();
		store.setWorker(
			createWorker({
				workerType: 'session',
				connectionId: undefined,
				workState: { kind: 'offline' },
			}),
		);
		const mailbox = new StoreBackedMailbox(store);

		expect(mailbox.resolve('worker-1')).toBeUndefined();
		expect(mailbox.isOnline('worker-1')).toBe(false);
	});
});
