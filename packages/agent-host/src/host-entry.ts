// Domain types needed to implement IHostStore
export type { ICommitmentRecord } from './domain/commitment';
export type { IDelegationRecord } from './domain/delegation';
export type { IInboxEntry, InboxEntryStatus } from './domain/inbox';
export type { IRoomMember } from './domain/membership';
export type { IRoomMessage } from './domain/room-message';
export type { ITaskBoardEntry } from './domain/task-board';
export type { ICallerContext } from './host/host-core';
// Core runtime
export { HostCore } from './host/host-core';
// Configuration
export type { IDirectAdmissionGuardOptions } from './policy/direct-admission-guard';
// Built-in store implementation
export { InMemoryStore } from './store/in-memory-store';
// Store interface — implement IHostStore to inject a custom store
export type {
	IConnectionMeta,
	IHostStore,
	IRoomMessageFilter,
	IStoreSnapshot,
} from './store/store';
