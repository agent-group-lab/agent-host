import {
	DIRECT_RESPONSE,
	type DirectReasonCode,
	type IDirectRequestPayload,
	type IDirectResponsePayload,
} from '@agent-group-lab/contracts/messages';
import type {
	IProtocolEnvelope,
	IProtocolTrace,
} from '@agent-group-lab/protocol';
import { nanoid } from 'nanoid';
import { createTaskInboxWorkRef } from '~/domain/inbox';
import type { ITaskBoardEntry } from '~/domain/task-board';
import type { IHostStore } from '~/store/store';
import type { IInbox } from '../infra/inbox';

interface IWorkQueueServiceOptions {
	store: IHostStore;
	inbox: IInbox;
	clearDeferredDispatch: (entryId: string) => void;
	restoreRequesterWorkState: (
		agentId: string,
		requestId: string,
		sourceTaskId?: string,
	) => void;
	sendToConnection: (
		connectionId: string,
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => Promise<void>;
	sendHostAck: (input: {
		requesterConnectionId: string;
		request: Pick<
			IDirectRequestPayload,
			| 'requestId'
			| 'fromAgentId'
			| 'fromAgentName'
			| 'toAgentId'
			| 'toAgentName'
		>;
		trace: IProtocolTrace | undefined;
		ackKind: 'queued' | 'admission_rejected';
		reasonCode: DirectReasonCode;
		reason: string;
	}) => Promise<void>;
	log: (message: string) => void;
}

export class WorkQueueService {
	private readonly options: IWorkQueueServiceOptions;

	constructor(options: IWorkQueueServiceOptions) {
		this.options = options;
	}

	ensureTaskWorkQueued = (
		task: ITaskBoardEntry,
		sourceAgentId: string,
		sourceAgentName?: string,
	) => {
		if (
			!task.assigneeId ||
			task.status !== 'todo' ||
			this.options.store.getCommitmentByTaskId(task.taskId)
		) {
			return;
		}

		const existing = this.findTaskWorkEntry(task.taskId);
		if (existing) {
			const isOpenStatus =
				existing.status === 'queued' ||
				existing.status === 'reserved' ||
				existing.status === 'dispatched';
			if (isOpenStatus && existing.toAgentId === task.assigneeId) {
				return;
			}
			if (isOpenStatus) {
				this.options.inbox.transition(existing.entryId, 'dropped');
			}
		}

		this.options.inbox.add({
			entryId: nanoid(),
			toAgentId: task.assigneeId,
			toAgentName: task.assigneeName,
			fromAgentId: sourceAgentId,
			fromAgentName: sourceAgentName,
			requestId: this.createTaskWorkRequestId(task.taskId),
			work: createTaskInboxWorkRef({
				taskId: task.taskId,
				targetAgentId: task.assigneeId,
				sourceAgentId,
				deadline: task.slaDeadline,
			}),
			payload: {
				taskId: task.taskId,
				turnId: task.turnId,
			},
		});
	};

	dropInboxEntriesForWorker = (agentId: string) => {
		const queuedEntries = [
			...this.options.inbox.getByAgent(agentId, { status: 'queued' }),
			...this.options.inbox.getByAgent(agentId, { status: 'reserved' }),
		];
		for (const entry of queuedEntries) {
			this.options.inbox.transition(entry.entryId, 'dropped');
			this.options.clearDeferredDispatch(entry.entryId);
			if (entry.work.workKind !== 'direct') {
				continue;
			}
			const queuedPayload = entry.payload;
			const sourceTaskId =
				typeof queuedPayload?.sourceTaskId === 'string'
					? queuedPayload.sourceTaskId
					: undefined;
			this.options.restoreRequesterWorkState(
				entry.fromAgentId,
				entry.requestId,
				sourceTaskId,
			);
		}

		const inFlightEntries = this.options.inbox.getByAgent(agentId, {
			status: 'dispatched',
		});
		for (const entry of inFlightEntries) {
			this.options.inbox.transition(entry.entryId, 'dropped');
			this.options.clearDeferredDispatch(entry.entryId);
			if (entry.work.workKind !== 'direct') {
				continue;
			}
			const storedPayload = entry.payload;
			const sourceTaskId =
				typeof storedPayload?.sourceTaskId === 'string'
					? storedPayload.sourceTaskId
					: undefined;
			this.options.restoreRequesterWorkState(
				entry.fromAgentId,
				entry.requestId,
				sourceTaskId,
			);
			const requesterConnectionId =
				typeof storedPayload?.requesterConnectionId === 'string'
					? storedPayload.requesterConnectionId
					: undefined;
			if (requesterConnectionId) {
				const ackResponse: IDirectResponsePayload = {
					requestId: entry.requestId,
					fromAgentId: entry.toAgentId,
					fromAgentName:
						this.options.store.getWorker(entry.toAgentId)?.agentName ??
						entry.toAgentId,
					toAgentId: entry.fromAgentId,
					toAgentName:
						this.options.store.getWorker(entry.fromAgentId)?.agentName ??
						entry.fromAgentId,
					action: 'ACK',
					origin: 'host',
					ackKind: 'admission_rejected',
					reasonCode: 'target_offline',
					reason: 'Worker disconnected',
				};
				this.options
					.sendToConnection(requesterConnectionId, {
						type: DIRECT_RESPONSE,
						channel: `direct:${entry.requestId}`,
						payload: ackResponse,
					})
					.catch((error) => {
						this.options.log(
							`Failed to notify about disconnected worker: ${error instanceof Error ? error.message : String(error)}`,
						);
					});
			}
		}
	};

	/**
	 * Marks the inbox entry for a task as completed or dropped.
	 * This is the public form of the former private markTaskWorkOutcome.
	 */
	completeTaskWork = (taskId: string, nextStatus: 'completed' | 'dropped') => {
		const entry = this.findTaskWorkEntry(taskId);
		if (!entry) {
			return;
		}
		if (
			entry.status !== 'queued' &&
			entry.status !== 'reserved' &&
			entry.status !== 'dispatched'
		) {
			return;
		}
		this.options.inbox.transition(entry.entryId, nextStatus);
	};

	private createTaskWorkRequestId = (taskId: string) => {
		return `task:${taskId}`;
	};

	private findTaskWorkEntry = (taskId: string) => {
		return this.options.store.listInboxEntries().find((entry) => {
			if (entry.work.workKind !== 'task') {
				return false;
			}
			return entry.work.payloadRef.taskId === taskId;
		});
	};
}
