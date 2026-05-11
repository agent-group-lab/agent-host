import type { IHostWorkerRecord } from '@agent-group-lab/contracts/messages';
import type { WorkStateKind } from '@agent-group-lab/contracts/work';
import type { ICommitmentRecord } from '~/domain/commitment';
import type { IDelegationRecord } from '~/domain/delegation';
import type { IInboxEntry, InboxEntryStatus } from '~/domain/inbox';
import type { IRoomMember } from '~/domain/membership';
import type { IRoomMessage } from '~/domain/room-message';
import type { ITaskBoardEntry, TaskBoardStatus } from '~/domain/task-board';

export interface IConnectionMeta {
	connectionId: string;
	connectionRole: 'unknown' | 'worker' | 'client';
	agentId?: string;
	ready: boolean;
	connectedAt: number;
}

export interface IStoreSnapshot {
	members: IRoomMember[];
	roomMessages: IRoomMessage[];
	workers: IHostWorkerRecord[];
	taskBoard: ITaskBoardEntry[];
	commitments: ICommitmentRecord[];
	delegations: IDelegationRecord[];
	inboxEntries: IInboxEntry[];
	seq: number;
	stateRevision: number;
}

export interface ITaskBoardFilter {
	status?: TaskBoardStatus;
	assigneeId?: string;
	parentTaskId?: string;
}

export interface IWorkerRegistry {
	getWorker: (agentId: string) => IHostWorkerRecord | undefined;
	setWorker: (record: IHostWorkerRecord) => void;
	deleteWorker: (agentId: string) => boolean;
	listWorkers: (filter?: { kind?: WorkStateKind }) => IHostWorkerRecord[];
	findWorkerByConnectionId: (
		connectionId: string,
	) => IHostWorkerRecord | undefined;
}

export interface IMembershipStore {
	getMember: (agentId: string) => IRoomMember | undefined;
	setMember: (record: IRoomMember) => void;
	deleteMember: (agentId: string) => boolean;
	listMembers: () => IRoomMember[];
}

export interface ICommitmentStore {
	getCommitment: (commitmentId: string) => ICommitmentRecord | undefined;
	getCommitmentByTaskId: (taskId: string) => ICommitmentRecord | undefined;
	getActiveCommitments: () => ICommitmentRecord[];
	setCommitment: (record: ICommitmentRecord) => void;
	deleteCommitment: (commitmentId: string) => boolean;
}

export interface IRoomMessageFilter {
	toAgentId?: string;
	includeBroadcast?: boolean;
	after?: {
		createdAt: number;
		messageId: string;
	};
	limit?: number;
}

export interface IRoomMessageStore {
	getRoomMessage: (messageId: string) => IRoomMessage | undefined;
	addRoomMessage: (message: IRoomMessage) => void;
	deleteRoomMessage: (messageId: string) => boolean;
	listRoomMessages: (filter?: IRoomMessageFilter) => IRoomMessage[];
	deleteExpiredRoomMessages: (now?: number) => number;
}

export interface ITaskBoardStore {
	getTaskBoardEntry: (taskId: string) => ITaskBoardEntry | undefined;
	getTaskBoardEntries: (filter?: ITaskBoardFilter) => ITaskBoardEntry[];
	getChildTasks: (parentTaskId: string) => ITaskBoardEntry[];
	getBlockedByTask: (taskId: string) => ITaskBoardEntry[];
	setTaskBoardEntry: (entry: ITaskBoardEntry) => void;
	deleteTaskBoardEntry: (taskId: string) => boolean;
}

export interface IDelegationStore {
	getDelegation: (delegationId: string) => IDelegationRecord | undefined;
	getDelegationsByOriginalTask: (taskId: string) => IDelegationRecord[];
	getDelegationsByDelegatee: (agentId: string) => IDelegationRecord[];
	setDelegation: (delegation: IDelegationRecord) => void;
	deleteDelegation: (delegationId: string) => boolean;
}

export interface IInboxStore {
	getInboxEntry: (entryId: string) => IInboxEntry | undefined;
	setInboxEntry: (entry: IInboxEntry) => void;
	deleteInboxEntry: (entryId: string) => boolean;
	listInboxEntries: (filter?: {
		toAgentId?: string;
		status?: InboxEntryStatus;
	}) => IInboxEntry[];
}

export interface IConnectionStore {
	getConnection: (connectionId: string) => IConnectionMeta | undefined;
	setConnection: (meta: IConnectionMeta) => void;
	deleteConnection: (connectionId: string) => boolean;
	listConnections: () => IConnectionMeta[];
	readonly connectionRevision: number;
}

export interface ISequenceStore {
	nextSeq: () => number;
}

export interface ISnapshotStore {
	snapshot: () => IStoreSnapshot;
	restore: (snapshot: IStoreSnapshot) => void;

	clear: () => void;
}

export type IHostStore = IWorkerRegistry &
	IMembershipStore &
	ICommitmentStore &
	IRoomMessageStore &
	ITaskBoardStore &
	IDelegationStore &
	IInboxStore &
	IConnectionStore &
	ISequenceStore &
	ISnapshotStore;
