import type { IHostWorkerRecord } from '@agent-group-lab/contracts/messages';
import type { WorkStateKind } from '@agent-group-lab/contracts/work';
import {
	type ICommitmentRecord,
	isCommitmentTerminal,
} from '~/domain/commitment';
import type { IDelegationRecord } from '~/domain/delegation';
import type { IInboxEntry, InboxEntryStatus } from '~/domain/inbox';
import type { IRoomMember } from '~/domain/membership';
import type { IRoomMessage } from '~/domain/room-message';
import type { ITaskBoardEntry } from '~/domain/task-board';
import type {
	IConnectionMeta,
	IHostStore,
	IRoomMessageFilter,
	IStoreSnapshot,
	ITaskBoardFilter,
} from './store';

export class InMemoryStore implements IHostStore {
	private readonly members = new Map<string, IRoomMember>();
	private readonly roomMessages = new Map<string, IRoomMessage>();
	private readonly workers = new Map<string, IHostWorkerRecord>();
	private readonly taskBoard = new Map<string, ITaskBoardEntry>();
	private readonly taskBoardChildIndex = new Map<string, Set<string>>();
	private readonly commitments = new Map<string, ICommitmentRecord>();
	private readonly delegations = new Map<string, IDelegationRecord>();
	private readonly inboxEntries = new Map<string, IInboxEntry>();
	private readonly connections = new Map<string, IConnectionMeta>();
	private sortedTaskBoardCache?: {
		entries: ITaskBoardEntry[];
		revision: number;
	};
	private seq = 0;
	private stateRevision = 0;
	private _connectionRevision = 0;

	getWorker = (agentId: string) => {
		return this.workers.get(agentId);
	};

	getMember = (agentId: string) => {
		return this.members.get(agentId);
	};

	setMember = (record: IRoomMember) => {
		const existing = this.members.get(record.agentId);
		if (existing) {
			const next = {
				...existing,
				agentName: record.agentName,
			} satisfies IRoomMember;
			if (!this.hasRecordChanged(existing, next)) {
				return;
			}
			this.members.set(record.agentId, next);
			this.bumpStateRevision();
			return;
		}
		this.members.set(record.agentId, record);
		this.bumpStateRevision();
	};

	deleteMember = (agentId: string) => {
		const deleted = this.members.delete(agentId);
		if (deleted) {
			this.bumpStateRevision();
		}
		return deleted;
	};

	listMembers = () => {
		return [...this.members.values()];
	};

	getRoomMessage = (messageId: string) => {
		return this.roomMessages.get(messageId);
	};

	addRoomMessage = (message: IRoomMessage) => {
		const current = this.roomMessages.get(message.messageId);
		if (!this.hasRecordChanged(current, message)) {
			return;
		}
		this.roomMessages.set(message.messageId, message);
		this.bumpStateRevision();
	};

	deleteRoomMessage = (messageId: string) => {
		const deleted = this.roomMessages.delete(messageId);
		if (deleted) {
			this.bumpStateRevision();
		}
		return deleted;
	};

	listRoomMessages = (filter?: IRoomMessageFilter) => {
		const now = Date.now();
		const allMessages = [...this.roomMessages.values()]
			.filter((message) => {
				return message.expiresAt === undefined || message.expiresAt > now;
			})
			.sort((left, right) => {
				if (left.createdAt !== right.createdAt) {
					return left.createdAt - right.createdAt;
				}
				return left.messageId.localeCompare(right.messageId);
			});

		if (!filter) {
			return allMessages;
		}

		const messages = allMessages.filter((message) => {
			const matchesDirect =
				filter.toAgentId !== undefined &&
				message.toAgentId === filter.toAgentId;
			const matchesBroadcast =
				filter.includeBroadcast === true && message.toAgentId === undefined;

			if (filter.toAgentId !== undefined) {
				if (filter.includeBroadcast === true) {
					return matchesDirect || matchesBroadcast;
				}
				return matchesDirect;
			}

			if (filter.includeBroadcast === true) {
				return matchesBroadcast;
			}

			return false;
		});

		const afterFiltered = !filter?.after
			? messages
			: messages.filter((message) => {
					if (message.createdAt > filter.after!.createdAt) {
						return true;
					}
					if (message.createdAt < filter.after!.createdAt) {
						return false;
					}
					return message.messageId > filter.after!.messageId;
				});

		if (filter?.limit === undefined) {
			return afterFiltered;
		}

		return afterFiltered.slice(0, filter.limit + 1);
	};

	deleteExpiredRoomMessages = (now = Date.now()) => {
		let deletedCount = 0;
		for (const [messageId, message] of this.roomMessages.entries()) {
			if (message.expiresAt === undefined || message.expiresAt > now) {
				continue;
			}
			this.roomMessages.delete(messageId);
			deletedCount += 1;
		}
		if (deletedCount > 0) {
			this.bumpStateRevision();
		}
		return deletedCount;
	};

	setWorker = (record: IHostWorkerRecord) => {
		const current = this.workers.get(record.agentId);
		if (!this.hasRecordChanged(current, record)) {
			return;
		}
		this.workers.set(record.agentId, record);
		this.bumpStateRevision();
	};

	deleteWorker = (agentId: string) => {
		const deleted = this.workers.delete(agentId);
		if (deleted) {
			this.bumpStateRevision();
		}
		return deleted;
	};

	listWorkers = (filter?: { kind?: WorkStateKind }) => {
		const workers = [...this.workers.values()];
		if (!filter?.kind) {
			return workers;
		}
		return workers.filter((worker) => worker.workState.kind === filter.kind);
	};

	findWorkerByConnectionId = (connectionId: string) => {
		return [...this.workers.values()].find(
			(worker) =>
				worker.connectionId !== undefined &&
				worker.connectionId === connectionId,
		);
	};

	getCommitment = (commitmentId: string) => {
		return this.commitments.get(commitmentId);
	};

	getCommitmentByTaskId = (taskId: string) => {
		return [...this.commitments.values()].find(
			(commitment) => commitment.taskId === taskId,
		);
	};

	getActiveCommitments = () => {
		return [...this.commitments.values()].filter(
			(commitment) => !isCommitmentTerminal(commitment.status),
		);
	};

	setCommitment = (record: ICommitmentRecord) => {
		const current = this.commitments.get(record.commitmentId);
		if (!this.hasRecordChanged(current, record)) {
			return;
		}
		this.commitments.set(record.commitmentId, record);
		this.bumpStateRevision();
	};

	deleteCommitment = (commitmentId: string) => {
		const deleted = this.commitments.delete(commitmentId);
		if (deleted) {
			this.bumpStateRevision();
		}
		return deleted;
	};

	getTaskBoardEntry = (taskId: string) => {
		return this.taskBoard.get(taskId);
	};

	getTaskBoardEntries = (filter?: ITaskBoardFilter) => {
		const entries = this.getSortedTaskBoardEntries();
		if (!filter) {
			return entries.slice();
		}
		return entries.filter((entry) => {
			if (filter.status && entry.status !== filter.status) {
				return false;
			}
			if (filter.assigneeId && entry.assigneeId !== filter.assigneeId) {
				return false;
			}
			if (filter.parentTaskId && entry.parentTaskId !== filter.parentTaskId) {
				return false;
			}
			return true;
		});
	};

	getChildTasks = (parentTaskId: string) => {
		const childIds = this.taskBoardChildIndex.get(parentTaskId);
		if (!childIds) {
			return [];
		}
		const children: ITaskBoardEntry[] = [];
		for (const taskId of childIds) {
			const task = this.taskBoard.get(taskId);
			if (task) {
				children.push(task);
			}
		}
		return children;
	};

	getBlockedByTask = (taskId: string) => {
		return this.getTaskBoardEntries({ status: 'blocked' }).filter((entry) =>
			entry.dependencies.includes(taskId),
		);
	};

	setTaskBoardEntry = (entry: ITaskBoardEntry) => {
		const current = this.taskBoard.get(entry.taskId);
		if (!this.hasRecordChanged(current, entry)) {
			return;
		}
		if (current?.parentTaskId && current.parentTaskId !== entry.parentTaskId) {
			this.removeFromTaskBoardChildIndex(current.parentTaskId, current.taskId);
		}
		this.taskBoard.set(entry.taskId, entry);
		if (entry.parentTaskId) {
			this.addToTaskBoardChildIndex(entry.parentTaskId, entry.taskId);
		}
		this.bumpStateRevision();
	};

	deleteTaskBoardEntry = (taskId: string) => {
		const current = this.taskBoard.get(taskId);
		const deleted = this.taskBoard.delete(taskId);
		if (deleted) {
			if (current?.parentTaskId) {
				this.removeFromTaskBoardChildIndex(current.parentTaskId, taskId);
			}
			this.bumpStateRevision();
		}
		return deleted;
	};

	getDelegation = (delegationId: string) => {
		return this.delegations.get(delegationId);
	};

	getDelegationsByOriginalTask = (taskId: string) => {
		return [...this.delegations.values()].filter(
			(delegation) => delegation.originalTaskId === taskId,
		);
	};

	getDelegationsByDelegatee = (agentId: string) => {
		return [...this.delegations.values()].filter(
			(delegation) => delegation.delegateeId === agentId,
		);
	};

	setDelegation = (delegation: IDelegationRecord) => {
		const current = this.delegations.get(delegation.delegationId);
		if (!this.hasRecordChanged(current, delegation)) {
			return;
		}
		this.delegations.set(delegation.delegationId, delegation);
		this.bumpStateRevision();
	};

	deleteDelegation = (delegationId: string) => {
		const deleted = this.delegations.delete(delegationId);
		if (deleted) {
			this.bumpStateRevision();
		}
		return deleted;
	};

	getInboxEntry = (entryId: string) => {
		return this.inboxEntries.get(entryId);
	};

	setInboxEntry = (entry: IInboxEntry) => {
		const current = this.inboxEntries.get(entry.entryId);
		if (!this.hasRecordChanged(current, entry)) {
			return;
		}
		this.inboxEntries.set(entry.entryId, entry);
		this.bumpStateRevision();
	};

	deleteInboxEntry = (entryId: string) => {
		const deleted = this.inboxEntries.delete(entryId);
		if (deleted) {
			this.bumpStateRevision();
		}
		return deleted;
	};

	listInboxEntries = (filter?: {
		toAgentId?: string;
		status?: InboxEntryStatus;
	}) => {
		const entries = [...this.inboxEntries.values()];
		if (!filter?.toAgentId && !filter?.status) {
			return entries;
		}
		return entries.filter((entry) => {
			if (filter?.toAgentId && entry.toAgentId !== filter.toAgentId) {
				return false;
			}
			if (filter?.status && entry.status !== filter.status) {
				return false;
			}
			return true;
		});
	};

	getConnection = (connectionId: string) => {
		return this.connections.get(connectionId);
	};

	setConnection = (meta: IConnectionMeta) => {
		this.connections.set(meta.connectionId, meta);
		this._connectionRevision += 1;
	};

	deleteConnection = (connectionId: string) => {
		const deleted = this.connections.delete(connectionId);
		if (deleted) {
			this._connectionRevision += 1;
		}
		return deleted;
	};

	get connectionRevision() {
		return this._connectionRevision;
	}

	listConnections = () => {
		return [...this.connections.values()];
	};

	nextSeq = () => {
		this.seq += 1;
		return this.seq;
	};

	snapshot = () => {
		return {
			members: [...this.members.values()],
			roomMessages: [...this.roomMessages.values()],
			workers: [...this.workers.values()],
			taskBoard: [...this.taskBoard.values()],
			commitments: [...this.commitments.values()],
			delegations: [...this.delegations.values()],
			inboxEntries: [...this.inboxEntries.values()],
			seq: this.seq,
			stateRevision: this.stateRevision,
		} satisfies IStoreSnapshot;
	};

	restore = (snapshot: IStoreSnapshot) => {
		this.members.clear();
		this.roomMessages.clear();
		this.workers.clear();
		this.taskBoard.clear();
		this.taskBoardChildIndex.clear();
		this.commitments.clear();
		this.delegations.clear();
		this.inboxEntries.clear();
		this.connections.clear();

		for (const member of snapshot.members) {
			this.members.set(member.agentId, member);
		}
		for (const message of snapshot.roomMessages) {
			this.roomMessages.set(message.messageId, message);
		}
		for (const worker of snapshot.workers) {
			this.workers.set(worker.agentId, worker);
		}
		for (const taskEntry of snapshot.taskBoard ?? []) {
			this.taskBoard.set(taskEntry.taskId, taskEntry);
		}
		this.rebuildTaskBoardChildIndex();
		for (const commitment of snapshot.commitments ?? []) {
			this.commitments.set(commitment.commitmentId, commitment);
		}
		for (const delegation of snapshot.delegations ?? []) {
			this.delegations.set(delegation.delegationId, delegation);
		}
		for (const entry of snapshot.inboxEntries ?? []) {
			this.inboxEntries.set(entry.entryId, entry);
		}
		this.seq = snapshot.seq;
		this.stateRevision = snapshot.stateRevision ?? snapshot.seq;
		this.sortedTaskBoardCache = undefined;
	};

	clear = () => {
		this.members.clear();
		this.roomMessages.clear();
		this.workers.clear();
		this.taskBoard.clear();
		this.taskBoardChildIndex.clear();
		this.commitments.clear();
		this.delegations.clear();
		this.inboxEntries.clear();
		this.connections.clear();
		this.seq = 0;
		this.stateRevision = 0;
		this._connectionRevision = 0;
		this.sortedTaskBoardCache = undefined;
	};

	private hasRecordChanged = <T>(current: T | undefined, next: T) => {
		if (!current) {
			return true;
		}
		return JSON.stringify(current) !== JSON.stringify(next);
	};

	private bumpStateRevision = () => {
		this.stateRevision += 1;
		this.sortedTaskBoardCache = undefined;
	};

	private addToTaskBoardChildIndex = (parentTaskId: string, taskId: string) => {
		const childIds =
			this.taskBoardChildIndex.get(parentTaskId) ?? new Set<string>();
		childIds.add(taskId);
		this.taskBoardChildIndex.set(parentTaskId, childIds);
	};

	private removeFromTaskBoardChildIndex = (
		parentTaskId: string,
		taskId: string,
	) => {
		const childIds = this.taskBoardChildIndex.get(parentTaskId);
		if (!childIds) {
			return;
		}
		childIds.delete(taskId);
		if (childIds.size === 0) {
			this.taskBoardChildIndex.delete(parentTaskId);
		}
	};

	private rebuildTaskBoardChildIndex = () => {
		this.taskBoardChildIndex.clear();
		for (const task of this.taskBoard.values()) {
			if (!task.parentTaskId) {
				continue;
			}
			this.addToTaskBoardChildIndex(task.parentTaskId, task.taskId);
		}
	};

	private getSortedTaskBoardEntries = () => {
		const cached = this.sortedTaskBoardCache;
		if (cached && cached.revision === this.stateRevision) {
			return cached.entries;
		}

		const entries = [...this.taskBoard.values()].sort((left, right) => {
			if (left.createdAt !== right.createdAt) {
				return left.createdAt - right.createdAt;
			}
			return left.taskId.localeCompare(right.taskId);
		});
		this.sortedTaskBoardCache = {
			entries,
			revision: this.stateRevision,
		};
		return entries;
	};
}
