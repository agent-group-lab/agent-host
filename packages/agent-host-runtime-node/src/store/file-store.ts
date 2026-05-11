import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
	type ICommitmentRecord,
	type IDelegationRecord,
	type IHostStore,
	type IInboxEntry,
	type InboxEntryStatus,
	InMemoryStore,
	type IRoomMember,
	type IRoomMessage,
	type IRoomMessageFilter,
	type ITaskBoardEntry,
} from '@agent-group-lab/agent-host/host';
import type { IHostWorkerRecord } from '@agent-group-lab/contracts/messages';
import type { WorkStateKind } from '@agent-group-lab/contracts/work';
import { nanoid } from 'nanoid';

export interface IFileStoreOptions {
	dir?: string;
}

interface IHostFile {
	version: number;
	deviceId: string;
	updatedAt: number;
	snapshot: ReturnType<InMemoryStore['snapshot']>;
}

export interface IHostPersistentStore extends IHostStore {
	load: () => void;
	flush: () => void;
}

export class FileStore implements IHostPersistentStore {
	private readonly inner = new InMemoryStore();
	private readonly filePath: string;
	private deviceId = `device_${nanoid(8)}`;

	constructor(options?: IFileStoreOptions) {
		const dir = options?.dir ?? join(homedir(), '.swarm');
		mkdirSync(dir, { recursive: true });
		mkdirSync(join(dir, 'logs'), { recursive: true });
		this.filePath = join(dir, 'host.json');
	}

	load = () => {
		if (!existsSync(this.filePath)) {
			return;
		}

		const raw = readFileSync(this.filePath, 'utf-8');
		const data = JSON.parse(raw) as IHostFile;
		if (data.version !== 1) {
			throw new Error(`Unsupported host.json version: ${data.version}`);
		}

		this.deviceId = data.deviceId;
		this.inner.restore(data.snapshot);

		for (const worker of this.inner.listWorkers()) {
			this.inner.setWorker({
				...worker,
				workState: { kind: 'offline' },
			});
		}

		for (const entry of this.inner.getTaskBoardEntries()) {
			if (entry.status !== 'assigned' && entry.status !== 'doing') {
				continue;
			}
			this.inner.setTaskBoardEntry({
				...entry,
				status: 'cancelled',
				failureMessage: 'Host restarted',
				completedAt: Date.now(),
			});
		}

		for (const entry of this.inner.listInboxEntries()) {
			const normalizedWork = this.normalizeInboxWork(entry);
			const status = entry.status as string;
			const shouldDropInFlight =
				status === 'queued' ||
				status === 'reserved' ||
				status === 'dispatched' ||
				status === 'untriaged' ||
				status === 'handled';
			if (shouldDropInFlight) {
				this.inner.setInboxEntry({
					...entry,
					work: normalizedWork,
					status: 'dropped',
					updatedAt: Date.now(),
				});
				continue;
			}

			if (normalizedWork !== entry.work) {
				this.inner.setInboxEntry({
					...entry,
					work: normalizedWork,
					updatedAt: Date.now(),
				});
			}
		}
	};

	flush = () => {
		const data: IHostFile = {
			version: 1,
			deviceId: this.deviceId,
			updatedAt: Date.now(),
			snapshot: this.inner.snapshot(),
		};
		writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
	};

	getWorker = this.inner.getWorker;
	getMember = this.inner.getMember;
	setWorker = this.inner.setWorker;
	setMember = this.inner.setMember as (record: IRoomMember) => void;
	deleteWorker = this.inner.deleteWorker;
	deleteMember = this.inner.deleteMember;
	listWorkers = this.inner.listWorkers as (filter?: {
		kind?: WorkStateKind;
	}) => IHostWorkerRecord[];
	listMembers = this.inner.listMembers;
	findWorkerByConnectionId = this.inner.findWorkerByConnectionId;

	getCommitment = this.inner.getCommitment;
	getCommitmentByTaskId = this.inner.getCommitmentByTaskId;
	getActiveCommitments = this.inner.getActiveCommitments;
	setCommitment = this.inner.setCommitment as (
		record: ICommitmentRecord,
	) => void;
	deleteCommitment = this.inner.deleteCommitment;

	getRoomMessage = this.inner.getRoomMessage;
	addRoomMessage = this.inner.addRoomMessage as (message: IRoomMessage) => void;
	deleteRoomMessage = this.inner.deleteRoomMessage;
	listRoomMessages = this.inner.listRoomMessages as (
		filter?: IRoomMessageFilter,
	) => IRoomMessage[];
	deleteExpiredRoomMessages = this.inner.deleteExpiredRoomMessages;

	getTaskBoardEntry = this.inner.getTaskBoardEntry;
	getTaskBoardEntries = this.inner.getTaskBoardEntries as (
		filter?: unknown,
	) => ITaskBoardEntry[];
	getChildTasks = this.inner.getChildTasks;
	getBlockedByTask = this.inner.getBlockedByTask;
	setTaskBoardEntry = this.inner.setTaskBoardEntry as (
		entry: ITaskBoardEntry,
	) => void;
	deleteTaskBoardEntry = this.inner.deleteTaskBoardEntry;

	getDelegation = this.inner.getDelegation;
	getDelegationsByOriginalTask = this.inner.getDelegationsByOriginalTask;
	getDelegationsByDelegatee = this.inner.getDelegationsByDelegatee;
	setDelegation = this.inner.setDelegation as (
		delegation: IDelegationRecord,
	) => void;
	deleteDelegation = this.inner.deleteDelegation;

	getInboxEntry = this.inner.getInboxEntry;
	setInboxEntry = this.inner.setInboxEntry;
	deleteInboxEntry = this.inner.deleteInboxEntry;
	listInboxEntries = this.inner.listInboxEntries as (filter?: {
		toAgentId?: string;
		status?: InboxEntryStatus;
	}) => IInboxEntry[];

	getConnection = this.inner.getConnection;
	setConnection = this.inner.setConnection;
	deleteConnection = this.inner.deleteConnection;
	listConnections = this.inner.listConnections;
	get connectionRevision() {
		return this.inner.connectionRevision;
	}

	nextSeq = this.inner.nextSeq;
	snapshot = this.inner.snapshot;
	restore = this.inner.restore;
	clear = this.inner.clear;

	private normalizeInboxWork = (entry: IInboxEntry) => {
		if (entry.work) {
			return entry.work;
		}
		const payload = entry.payload as Record<string, unknown>;
		const sourceTaskId =
			typeof payload?.sourceTaskId === 'string'
				? payload.sourceTaskId
				: undefined;
		return {
			workId: entry.requestId,
			workKind: 'direct' as const,
			targetAgentId: entry.toAgentId,
			sourceAgentId: entry.fromAgentId,
			priority: 0,
			payloadRef: {
				requestId: entry.requestId,
				sourceTaskId,
			},
		} satisfies IInboxEntry['work'];
	};
}

export const isHostPersistentStore = (
	store: IHostStore,
): store is IHostPersistentStore => {
	return 'load' in store && 'flush' in store;
};
