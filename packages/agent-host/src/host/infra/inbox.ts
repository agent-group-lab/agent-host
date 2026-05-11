import {
	canTransitionInbox,
	createDirectInboxWorkRef,
	type IInboxAddInput,
	type IInboxEntry,
	type IInboxTransitionMetadata,
	type InboxEntryStatus,
} from '~/domain/inbox';
import type { IInboxStore } from '~/store/store';

export interface IInbox {
	add: (input: IInboxAddInput) => IInboxEntry;
	transition: (
		entryId: string,
		nextStatus: InboxEntryStatus,
		metadata?: IInboxTransitionMetadata,
	) => IInboxEntry;
	getByAgent: (
		agentId: string,
		filter?: { status?: InboxEntryStatus },
	) => IInboxEntry[];
	getDispatchCandidates: (agentId: string) => IInboxEntry[];
	dequeue: (agentId: string) => IInboxEntry | undefined;
	get: (entryId: string) => IInboxEntry | undefined;
	findByRequestId: (
		agentId: string,
		requestId: string,
	) => IInboxEntry | undefined;
}

export class StoreBackedInbox implements IInbox {
	constructor(private readonly store: IInboxStore) {}

	add = (input: IInboxAddInput) => {
		const now = Date.now();
		const entry: IInboxEntry = {
			entryId: input.entryId,
			toAgentId: input.toAgentId,
			toAgentName: input.toAgentName,
			fromAgentId: input.fromAgentId,
			fromAgentName: input.fromAgentName,
			requestId: input.requestId,
			status: 'queued',
			work:
				input.work ??
				createDirectInboxWorkRef({
					toAgentId: input.toAgentId,
					fromAgentId: input.fromAgentId,
					requestId: input.requestId,
				}),
			payload: input.payload,
			createdAt: now,
			updatedAt: now,
		};
		this.store.setInboxEntry(entry);
		return entry;
	};

	transition = (
		entryId: string,
		nextStatus: InboxEntryStatus,
		_metadata?: IInboxTransitionMetadata,
	) => {
		const entry = this.store.getInboxEntry(entryId);
		if (!entry) {
			throw new Error(`Inbox entry ${entryId} not found`);
		}
		if (!canTransitionInbox(entry.status, nextStatus)) {
			throw new Error(
				`Invalid inbox transition: ${entry.status} -> ${nextStatus}`,
			);
		}
		const updated: IInboxEntry = {
			...entry,
			status: nextStatus,
			updatedAt: Date.now(),
		};
		this.store.setInboxEntry(updated);
		return updated;
	};

	getByAgent = (agentId: string, filter?: { status?: InboxEntryStatus }) => {
		return this.store.listInboxEntries({
			toAgentId: agentId,
			status: filter?.status,
		});
	};

	getDispatchCandidates = (agentId: string) => {
		return this.store
			.listInboxEntries({ toAgentId: agentId, status: 'queued' })
			.sort((a, b) => {
				const priorityDelta = (b.work?.priority ?? 0) - (a.work?.priority ?? 0);
				if (priorityDelta !== 0) {
					return priorityDelta;
				}
				return a.createdAt - b.createdAt;
			});
	};

	dequeue = (agentId: string) => {
		const candidates = this.getDispatchCandidates(agentId);
		if (candidates.length === 0) {
			return undefined;
		}
		return candidates[0];
	};

	get = (entryId: string) => {
		return this.store.getInboxEntry(entryId);
	};

	findByRequestId = (agentId: string, requestId: string) => {
		const entries = this.store.listInboxEntries({ toAgentId: agentId });
		return entries.find((entry) => entry.requestId === requestId);
	};
}
