import type { IHostWorkerRecord } from '@agent-group-lab/contracts/messages';
import { describe, expect, it } from 'vitest';
import {
	createCommitmentRecord,
	type ICommitmentRecord,
} from '~/domain/commitment';
import {
	createDelegationRecord,
	type IDelegationRecord,
} from '~/domain/delegation';
import { createDirectInboxWorkRef, type IInboxEntry } from '~/domain/inbox';
import type { IRoomMessage } from '~/domain/room-message';
import type { ITaskBoardEntry } from '~/domain/task-board';
import { InMemoryStore } from './in-memory-store';
import type { IConnectionMeta } from './store';

const createMember = (
	overrides: Partial<{
		agentId: string;
		agentName: string;
		joinedAt: number;
	}> = {},
) => {
	return {
		agentId: overrides.agentId ?? 'member-1',
		agentName: overrides.agentName ?? 'Member One',
		joinedAt: overrides.joinedAt ?? Date.now(),
	};
};

const createWorker = (
	overrides: Partial<IHostWorkerRecord> = {},
): IHostWorkerRecord => {
	return {
		agentId: overrides.agentId ?? 'worker-1',
		agentName: overrides.agentName ?? overrides.agentId ?? 'worker-1',
		connectionId:
			'connectionId' in overrides ? overrides.connectionId : 'conn-1',
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
	};
};

const createConnection = (
	overrides: Partial<IConnectionMeta> = {},
): IConnectionMeta => {
	return {
		connectionId: overrides.connectionId ?? 'conn-1',
		connectionRole: overrides.connectionRole ?? 'unknown',
		agentId: overrides.agentId,
		ready: overrides.ready ?? false,
		connectedAt: overrides.connectedAt ?? Date.now(),
	};
};

const createCommitment = (
	overrides: Partial<ICommitmentRecord> = {},
): ICommitmentRecord => {
	return {
		...createCommitmentRecord({
			commitmentId: overrides.commitmentId ?? 'commitment-1',
			taskId: overrides.taskId ?? 'task-1',
			assigneeId: overrides.assigneeId ?? 'worker-1',
		}),
		...overrides,
	};
};

const createTaskBoardEntry = (
	overrides: Partial<ITaskBoardEntry> = {},
): ITaskBoardEntry => {
	return {
		taskId: overrides.taskId ?? 'task-board-1',
		turnId: overrides.turnId ?? 'turn-board-1',
		prompt: overrides.prompt ?? 'board task',
		workingDirectory: overrides.workingDirectory ?? process.cwd(),
		requesterConnectionId: overrides.requesterConnectionId ?? 'conn-client-1',
		parentTaskId: overrides.parentTaskId,
		assigneeId: overrides.assigneeId,
		assigneeName: overrides.assigneeName,
		assigneeRole: overrides.assigneeRole,
		status: overrides.status ?? 'todo',
		dependencies: overrides.dependencies ?? [],
		deliverableSpec: overrides.deliverableSpec,
		slaDeadline: overrides.slaDeadline,
		createdAt: overrides.createdAt ?? Date.now(),
		startedAt: overrides.startedAt,
		completedAt: overrides.completedAt,
		failureMessage: overrides.failureMessage,
		deliveredArtifact: overrides.deliveredArtifact,
	};
};

const createDelegation = (
	overrides: Partial<IDelegationRecord> = {},
): IDelegationRecord => {
	return {
		...createDelegationRecord(
			{
				delegationId: overrides.delegationId ?? 'delegation-1',
				delegatorId: overrides.delegatorId ?? 'lead-1',
				delegateeId: overrides.delegateeId ?? 'executor-1',
				originalTaskId: overrides.originalTaskId ?? 'task-root',
				delegatedTaskId: overrides.delegatedTaskId ?? 'task-sub',
			},
			overrides.createdAt,
		),
		...overrides,
	};
};

const createRoomMessage = (
	overrides: Partial<IRoomMessage> = {},
): IRoomMessage => {
	return {
		messageId: 'messageId' in overrides ? overrides.messageId! : 'message-1',
		fromAgentId:
			'fromAgentId' in overrides ? overrides.fromAgentId! : 'agent-a',
		fromAgentName:
			'fromAgentName' in overrides ? overrides.fromAgentName! : 'Agent A',
		toAgentId: 'toAgentId' in overrides ? overrides.toAgentId : 'agent-b',
		content: 'content' in overrides ? overrides.content! : 'hello',
		createdAt: 'createdAt' in overrides ? overrides.createdAt! : Date.now(),
		expiresAt: overrides.expiresAt,
	};
};

describe('in-memory-store', () => {
	it('supports worker/task/connection CRUD', () => {
		const store = new InMemoryStore();
		const worker = createWorker();
		const commitment = createCommitment();
		const taskBoard = createTaskBoardEntry({ taskId: 'task-1' });
		const delegation = createDelegation();
		const connection = createConnection();

		store.setWorker(worker);
		store.setCommitment(commitment);
		store.setTaskBoardEntry(taskBoard);
		store.setDelegation(delegation);
		store.setConnection(connection);

		expect(store.getWorker(worker.agentId)).toEqual(worker);
		expect(store.getCommitment(commitment.commitmentId)).toEqual(commitment);
		expect(store.getCommitmentByTaskId('task-1')).toEqual(commitment);
		expect(store.getTaskBoardEntry(taskBoard.taskId)).toEqual(taskBoard);
		expect(store.getDelegation(delegation.delegationId)).toEqual(delegation);
		expect(store.getConnection(connection.connectionId)).toEqual(connection);

		expect(store.deleteWorker(worker.agentId)).toBe(true);
		expect(store.deleteCommitment(commitment.commitmentId)).toBe(true);
		expect(store.deleteTaskBoardEntry(taskBoard.taskId)).toBe(true);
		expect(store.deleteDelegation(delegation.delegationId)).toBe(true);
		expect(store.deleteConnection(connection.connectionId)).toBe(true);
	});

	it('filters workers and taskBoard entries', () => {
		const store = new InMemoryStore();
		store.setWorker(
			createWorker({ agentId: 'w-idle', workState: { kind: 'idle' } }),
		);
		store.setWorker(
			createWorker({
				agentId: 'w-focused',
				workState: { kind: 'focused', taskId: 'task-2' },
			}),
		);
		store.setCommitment(
			createCommitment({
				commitmentId: 'c-active',
				taskId: 'task-running',
				status: 'accepted',
			}),
		);
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-board-blocked',
				status: 'blocked',
				dependencies: ['task-running'],
				parentTaskId: 'task-parent',
			}),
		);
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-parent',
				status: 'doing',
			}),
		);
		store.setDelegation(
			createDelegation({
				delegationId: 'delegation-a',
				originalTaskId: 'task-running',
				delegateeId: 'worker-1',
			}),
		);
		store.setDelegation(
			createDelegation({
				delegationId: 'delegation-b',
				originalTaskId: 'task-parent',
				delegateeId: 'worker-2',
			}),
		);
		store.setCommitment(
			createCommitment({
				commitmentId: 'c-done',
				taskId: 'task-failed',
				status: 'delivered',
			}),
		);

		expect(store.listWorkers()).toHaveLength(2);
		expect(store.listWorkers({ kind: 'idle' })).toHaveLength(1);
		expect(store.getActiveCommitments()).toHaveLength(1);
		expect(store.getTaskBoardEntries({ status: 'blocked' })).toHaveLength(1);
		expect(store.getChildTasks('task-parent')).toHaveLength(1);
		expect(store.getBlockedByTask('task-running')).toHaveLength(1);
		expect(store.getDelegationsByOriginalTask('task-running')).toHaveLength(1);
		expect(store.getDelegationsByDelegatee('worker-2')).toHaveLength(1);
	});

	it('findWorkerByConnectionId ignores workers without connections', () => {
		const store = new InMemoryStore();
		store.setWorker(
			createWorker({
				agentId: 'session-worker',
				connectionId: undefined,
				workerType: 'session',
			}),
		);
		store.setWorker(
			createWorker({
				agentId: 'push-worker',
				connectionId: 'conn-push',
			}),
		);

		expect(store.findWorkerByConnectionId('conn-push')?.agentId).toBe(
			'push-worker',
		);
		expect(store.findWorkerByConnectionId('conn-missing')).toBeUndefined();
	});

	it('returns taskBoard entries in stable createdAt/taskId order', () => {
		const store = new InMemoryStore();
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-b',
				createdAt: 100,
			}),
		);
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-a',
				createdAt: 100,
			}),
		);
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-c',
				createdAt: 101,
			}),
		);

		expect(store.getTaskBoardEntries().map((entry) => entry.taskId)).toEqual([
			'task-a',
			'task-b',
			'task-c',
		]);
	});

	it('returns a copy of cached taskBoard entries when no filter is provided', () => {
		const store = new InMemoryStore();
		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-a',
				createdAt: 100,
			}),
		);

		const first = store.getTaskBoardEntries();
		first.push(
			createTaskBoardEntry({
				taskId: 'task-mutated',
				createdAt: 101,
			}),
		);

		expect(store.getTaskBoardEntries().map((entry) => entry.taskId)).toEqual([
			'task-a',
		]);
	});

	it('supports inbox CRUD and filtering', () => {
		const store = new InMemoryStore();
		const entry: IInboxEntry = {
			entryId: 'inbox-1',
			toAgentId: 'agent-b',
			fromAgentId: 'agent-a',
			fromAgentName: 'agent-a',
			toAgentName: 'agent-b',
			requestId: 'req-1',
			status: 'queued',
			work: createDirectInboxWorkRef({
				toAgentId: 'agent-b',
				fromAgentId: 'agent-a',
				requestId: 'req-1',
			}),
			payload: { prompt: 'hello' },
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};

		store.setInboxEntry(entry);
		expect(store.getInboxEntry('inbox-1')).toEqual(entry);
		expect(store.listInboxEntries()).toHaveLength(1);
		expect(store.listInboxEntries({ toAgentId: 'agent-b' })).toHaveLength(1);
		expect(store.listInboxEntries({ toAgentId: 'agent-x' })).toHaveLength(0);
		expect(store.listInboxEntries({ status: 'queued' })).toHaveLength(1);
		expect(store.listInboxEntries({ status: 'dropped' })).toHaveLength(0);

		expect(store.deleteInboxEntry('inbox-1')).toBe(true);
		expect(store.getInboxEntry('inbox-1')).toBeUndefined();
	});

	it('supports membership CRUD with joinedAt preservation', () => {
		const store = new InMemoryStore();
		const joinedAt = 1_700_000_000_000;

		store.setMember(
			createMember({
				agentId: 'member-a',
				agentName: 'Member A',
				joinedAt,
			}),
		);
		expect(store.getMember('member-a')).toEqual({
			agentId: 'member-a',
			agentName: 'Member A',
			joinedAt,
		});

		store.setMember(
			createMember({
				agentId: 'member-a',
				agentName: 'Member A Renamed',
				joinedAt: joinedAt + 10,
			}),
		);
		expect(store.getMember('member-a')).toEqual({
			agentId: 'member-a',
			agentName: 'Member A Renamed',
			joinedAt,
		});

		expect(store.listMembers()).toEqual([
			{
				agentId: 'member-a',
				agentName: 'Member A Renamed',
				joinedAt,
			},
		]);
		expect(store.deleteMember('member-a')).toBe(true);
		expect(store.getMember('member-a')).toBeUndefined();
	});

	it('supports room message CRUD and query semantics', () => {
		const store = new InMemoryStore();
		const now = Date.now();

		store.addRoomMessage(
			createRoomMessage({
				messageId: 'message-1',
				toAgentId: 'agent-b',
				createdAt: now,
			}),
		);
		store.addRoomMessage(
			createRoomMessage({
				messageId: 'message-2',
				toAgentId: undefined,
				createdAt: now + 1,
			}),
		);
		store.addRoomMessage(
			createRoomMessage({
				messageId: 'message-3',
				toAgentId: 'agent-b',
				createdAt: now + 1,
			}),
		);
		store.addRoomMessage(
			createRoomMessage({
				messageId: 'message-expired',
				toAgentId: 'agent-b',
				createdAt: now + 2,
				expiresAt: now - 1,
			}),
		);

		expect(
			store.listRoomMessages().map((message) => message.messageId),
		).toEqual(['message-1', 'message-2', 'message-3']);
		expect(store.getRoomMessage('message-1')?.messageId).toBe('message-1');
		expect(
			store.listRoomMessages({
				toAgentId: 'agent-b',
			}),
		).toMatchObject([{ messageId: 'message-1' }, { messageId: 'message-3' }]);
		expect(
			store
				.listRoomMessages({
					toAgentId: 'agent-b',
					includeBroadcast: true,
				})
				.map((message) => message.messageId),
		).toEqual(['message-1', 'message-2', 'message-3']);
		expect(
			store
				.listRoomMessages({
					includeBroadcast: true,
				})
				.map((message) => message.messageId),
		).toEqual(['message-2']);

		const paged = store.listRoomMessages({
			toAgentId: 'agent-b',
			includeBroadcast: true,
			limit: 2,
		});
		expect(paged.map((message) => message.messageId)).toEqual([
			'message-1',
			'message-2',
			'message-3',
		]);

		expect(
			store.listRoomMessages({
				toAgentId: 'agent-b',
				includeBroadcast: true,
				after: {
					createdAt: now + 1,
					messageId: 'message-2',
				},
			}),
		).toMatchObject([{ messageId: 'message-3' }]);

		expect(store.deleteExpiredRoomMessages(now)).toBe(1);
		expect(store.getRoomMessage('message-expired')).toBeUndefined();
		expect(store.deleteRoomMessage('message-3')).toBe(true);
		expect(store.getRoomMessage('message-3')).toBeUndefined();
	});

	it('supports sequence, snapshot, restore and clear', () => {
		const store = new InMemoryStore();
		store.setMember(createMember({ agentId: 'member-snapshot' }));
		store.addRoomMessage(createRoomMessage({ messageId: 'message-snapshot' }));
		store.setWorker(createWorker({ agentId: 'worker-snapshot' }));
		store.setCommitment(
			createCommitment({
				commitmentId: 'commitment-snap',
				deliveredRequestId: undefined,
			}),
		);
		store.setTaskBoardEntry(
			createTaskBoardEntry({ taskId: 'task-board-snapshot' }),
		);
		store.setDelegation(
			createDelegation({ delegationId: 'delegation-snapshot' }),
		);
		store.setConnection(createConnection({ connectionId: 'conn-snapshot' }));
		store.setInboxEntry({
			entryId: 'inbox-snap',
			toAgentId: 'agent-b',
			toAgentName: 'agent-b',
			fromAgentId: 'agent-a',
			fromAgentName: 'agent-a',
			requestId: 'req-snap',
			status: 'queued',
			work: createDirectInboxWorkRef({
				toAgentId: 'agent-b',
				fromAgentId: 'agent-a',
				requestId: 'req-snap',
			}),
			payload: {},
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});

		expect(store.nextSeq()).toBe(1);
		expect(store.nextSeq()).toBe(2);

		const snapshot = store.snapshot();
		expect(snapshot.stateRevision).toBe(7);
		const restored = new InMemoryStore();
		restored.restore(snapshot);

		expect(restored.getMember('member-snapshot')?.agentId).toBe(
			'member-snapshot',
		);
		expect(restored.getWorker('worker-snapshot')?.agentId).toBe(
			'worker-snapshot',
		);
		expect(restored.getWorker('worker-snapshot')?.workerType).toBe(
			'persistent',
		);
		expect(restored.getRoomMessage('message-snapshot')?.messageId).toBe(
			'message-snapshot',
		);
		expect(restored.getCommitment('commitment-snap')?.taskId).toBe('task-1');
		expect(
			restored.getCommitment('commitment-snap')?.deliveredRequestId,
		).toBeUndefined();
		expect(restored.getTaskBoardEntry('task-board-snapshot')?.taskId).toBe(
			'task-board-snapshot',
		);
		expect(restored.getDelegation('delegation-snapshot')?.delegationId).toBe(
			'delegation-snapshot',
		);
		expect(restored.getInboxEntry('inbox-snap')?.status).toBe('queued');
		expect(restored.listConnections()).toHaveLength(0);
		expect(restored.nextSeq()).toBe(3);
		expect(restored.snapshot().stateRevision).toBe(snapshot.stateRevision);

		restored.clear();
		expect(restored.listMembers()).toHaveLength(0);
		expect(restored.listRoomMessages({ toAgentId: 'agent-b' })).toHaveLength(0);
		expect(restored.listWorkers()).toHaveLength(0);
		expect(restored.getActiveCommitments()).toHaveLength(0);
		expect(restored.getTaskBoardEntries()).toHaveLength(0);
		expect(restored.getDelegationsByOriginalTask('task-root')).toHaveLength(0);
		expect(restored.listInboxEntries()).toHaveLength(0);
		expect(restored.listConnections()).toHaveLength(0);
		expect(restored.nextSeq()).toBe(1);
		expect(restored.snapshot().stateRevision).toBe(0);
	});

	it('restores snapshots with required members and room messages collections', () => {
		const store = new InMemoryStore();

		store.restore({
			members: [],
			roomMessages: [],
			workers: [],
			taskBoard: [],
			commitments: [],
			delegations: [],
			inboxEntries: [],
			seq: 0,
			stateRevision: 0,
		});

		expect(store.listMembers()).toEqual([]);
		expect(store.listRoomMessages({ toAgentId: 'agent-a' })).toEqual([]);
	});

	it('tracks stateRevision only for business-state changes', () => {
		const store = new InMemoryStore();
		const worker = createWorker({ agentId: 'worker-revision' });
		const baseline = store.snapshot().stateRevision;

		store.nextSeq();
		store.setConnection(createConnection({ connectionId: 'conn-revision' }));
		expect(store.snapshot().stateRevision).toBe(baseline);

		store.setWorker(worker);
		const changed = store.snapshot().stateRevision;
		expect(changed).toBe(baseline + 1);

		store.setWorker({ ...worker });
		expect(store.snapshot().stateRevision).toBe(changed);
	});
});
