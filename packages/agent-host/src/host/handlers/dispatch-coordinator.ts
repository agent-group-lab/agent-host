import {
	DIRECT_REQUEST,
	type IDirectRequestPayload,
	type ITaskAssignPayload,
	type ITaskFailedPayload,
	TASK_ASSIGN,
	TASK_FAILED,
} from '@agent-group-lab/contracts/messages';
import type { WorkState } from '@agent-group-lab/contracts/work';
import type { IProtocolEnvelope } from '@agent-group-lab/protocol';
import type { IInboxEntry } from '~/domain/inbox';
import type { ITaskBoardEntry } from '~/domain/task-board';
import { getTaskIdFromWorkState } from '~/domain/work-state';
import type { ITriage } from '~/policy/triage';
import type { IHostPortConnection } from '~/ports/host-server-port';
import type {
	ICommitmentStore,
	IInboxStore,
	ITaskBoardStore,
	IWorkerRegistry,
} from '~/store/store';
import type { IInbox } from '../infra/inbox';
import type { IMailbox } from '../infra/mailbox';
import type { TaskBoardService } from '../services/task-board-service';
import type { TaskNotificationService } from '../services/task-notification-service';
import type { WorkerLifecycleService } from '../services/worker-lifecycle-service';

interface ICompleteWorkInput {
	agentId: string;
	workKind: 'task' | 'direct';
	workId: string;
	outcome: 'completed' | 'dropped';
}

interface IDispatchCoordinatorOptions {
	inbox: IInbox;
	store: IWorkerRegistry & ITaskBoardStore & IInboxStore & ICommitmentStore;
	mailbox: IMailbox;
	triage: ITriage;
	getLiveConnection: (connectionId: string) => IHostPortConnection | undefined;
	createEnvelope: (
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => IProtocolEnvelope<string, unknown>;
	sendToConnection: (
		connectionId: string,
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => Promise<void>;
	transitionWorkerState: (agentId: string, nextState: WorkState) => void;
	markWorkerOffline: (agentId: string) => void;
	createTaskAssignPayload: (task: ITaskBoardEntry) => ITaskAssignPayload;
	createForwardedDirectRequestPayload: (
		payload: IDirectRequestPayload,
	) => IDirectRequestPayload;
	taskBoardService: TaskBoardService;
	notificationService: TaskNotificationService;
	workerLifecycleService: WorkerLifecycleService;
	onDispatchFailureLog: (message: string) => void;
	deferredDispatchDelayMs?: number;
}

export class DispatchCoordinator {
	private readonly options: IDispatchCoordinatorOptions;
	private readonly deferredDispatchUntil = new Map<string, number>();
	private readonly deferredDispatchDelayMs: number;

	constructor(options: IDispatchCoordinatorOptions) {
		this.options = options;
		this.deferredDispatchDelayMs = options.deferredDispatchDelayMs ?? 250;
	}

	clearDeferredDispatch = (entryId: string) => {
		this.deferredDispatchUntil.delete(entryId);
	};

	findWorkEntry = (input: {
		agentId: string;
		workKind: 'task' | 'direct';
		workId: string;
	}) => {
		return this.options.store.listInboxEntries().find((entry) => {
			if (entry.toAgentId !== input.agentId) {
				return false;
			}
			return (
				entry.work.workKind === input.workKind &&
				entry.work.workId === input.workId
			);
		});
	};

	completeWork = (input: ICompleteWorkInput) => {
		const entry = this.findWorkEntry({
			agentId: input.agentId,
			workKind: input.workKind,
			workId: input.workId,
		});
		if (
			entry &&
			(entry.status === 'queued' ||
				entry.status === 'reserved' ||
				entry.status === 'dispatched')
		) {
			this.options.inbox.transition(entry.entryId, input.outcome);
			this.clearDeferredDispatch(entry.entryId);
		}

		const worker = this.options.store.getWorker(input.agentId);
		if (!worker || worker.workState.kind === 'offline') {
			return;
		}

		const focusedTaskId =
			input.workKind === 'direct' ? `direct:${input.workId}` : input.workId;
		if (getTaskIdFromWorkState(worker.workState) !== focusedTaskId) {
			return;
		}

		this.options.workerLifecycleService.recoverWorkerToIdle(
			worker.agentId,
			focusedTaskId,
		);
	};

	dispatchNextWorkForWorker = async (agentId: string) => {
		const attempted = new Set<string>();
		for (;;) {
			const worker = this.options.store.getWorker(agentId);
			if (!worker || worker.workState.kind !== 'idle') {
				return;
			}

			const next = this.getNextDispatchCandidate(agentId, attempted);
			if (!next) {
				return;
			}
			attempted.add(next.entryId);

			let dispatched: boolean;
			if (next.work.workKind === 'task') {
				dispatched = await this.dispatchQueuedTaskWork(next);
			} else {
				dispatched = await this.dispatchQueuedDirectWork(next);
			}
			if (dispatched) {
				this.clearDeferredDispatch(next.entryId);
				return;
			}

			const refreshedWorker = this.options.store.getWorker(agentId);
			if (!refreshedWorker || refreshedWorker.workState.kind !== 'idle') {
				return;
			}
			const current = this.options.inbox.get(next.entryId);
			if (!current || current.status !== 'queued') {
				this.clearDeferredDispatch(next.entryId);
			}
		}
	};

	private setDeferredDispatchBackoff = (
		entryId: string,
		now: number = Date.now(),
	) => {
		this.deferredDispatchUntil.set(entryId, now + this.deferredDispatchDelayMs);
	};

	private isDeferredDispatchBlocked = (entryId: string, now: number) => {
		const blockedUntil = this.deferredDispatchUntil.get(entryId);
		if (blockedUntil === undefined) {
			return false;
		}
		if (blockedUntil <= now) {
			this.deferredDispatchUntil.delete(entryId);
			return false;
		}
		return true;
	};

	private getNextDispatchCandidate = (
		agentId: string,
		attempted: Set<string>,
	) => {
		const now = Date.now();
		const candidates = this.options.inbox.getDispatchCandidates(agentId);
		for (const candidate of candidates) {
			if (attempted.has(candidate.entryId)) {
				continue;
			}
			if (this.isDeferredDispatchBlocked(candidate.entryId, now)) {
				continue;
			}
			return candidate;
		}
		return undefined;
	};

	private dispatchQueuedTaskWork = async (entry: IInboxEntry) => {
		if (this.options.inbox.get(entry.entryId)?.status !== 'queued') {
			return false;
		}

		if (entry.work.workKind !== 'task') {
			this.options.inbox.transition(entry.entryId, 'dropped');
			return false;
		}

		const taskId = entry.work.payloadRef.taskId;

		const taskBoard = this.options.store.getTaskBoardEntry(taskId);
		if (
			!taskBoard ||
			!taskBoard.assigneeId ||
			taskBoard.assigneeId !== entry.toAgentId
		) {
			this.options.inbox.transition(entry.entryId, 'dropped');
			return false;
		}
		if (taskBoard.status === 'done') {
			this.options.inbox.transition(entry.entryId, 'completed');
			return false;
		}
		if (taskBoard.status === 'cancelled' || taskBoard.status === 'blocked') {
			this.options.inbox.transition(entry.entryId, 'dropped');
			return false;
		}
		if (
			taskBoard.status !== 'todo' ||
			this.options.store.getCommitmentByTaskId(taskId)
		) {
			this.options.inbox.transition(entry.entryId, 'dropped');
			return false;
		}

		this.options.inbox.transition(entry.entryId, 'reserved');

		const worker = this.options.store.getWorker(taskBoard.assigneeId);
		if (!worker || worker.workState.kind !== 'idle') {
			this.options.inbox.transition(entry.entryId, 'queued');
			return false;
		}
		const connectionId = this.options.mailbox.resolve(worker.agentId);
		if (!connectionId) {
			if (worker.workerType !== 'session') {
				this.options.markWorkerOffline(worker.agentId);
			}
			this.options.inbox.transition(entry.entryId, 'queued');
			return false;
		}
		const workerConnection = this.options.getLiveConnection(connectionId);
		if (!workerConnection) {
			this.options.markWorkerOffline(worker.agentId);
			this.options.inbox.transition(entry.entryId, 'queued');
			return false;
		}

		try {
			this.options.transitionWorkerState(worker.agentId, {
				kind: 'focused',
				taskId,
			});
		} catch {
			this.options.inbox.transition(entry.entryId, 'queued');
			return false;
		}

		try {
			await workerConnection.send(
				this.options.createEnvelope({
					type: TASK_ASSIGN,
					channel: `task:${taskId}`,
					trace: {
						taskId,
						turnId: taskBoard.turnId,
					},
					payload: this.options.createTaskAssignPayload(taskBoard),
				}),
			);
			this.options.taskBoardService.markAssigned(taskId);
			this.options.inbox.transition(entry.entryId, 'dispatched');
			return true;
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: 'Failed to deliver queued task to worker';
			this.options.inbox.transition(entry.entryId, 'dropped');
			this.options.taskBoardService.markCancelled(taskId, message);
			this.options.markWorkerOffline(worker.agentId);
			await this.options.sendToConnection(taskBoard.requesterConnectionId, {
				type: TASK_FAILED,
				channel: `task:${taskId}`,
				trace: {
					taskId,
					turnId: taskBoard.turnId,
				},
				payload: {
					taskId,
					agentId: worker.agentId,
					agentName: worker.agentName,
					message,
				} satisfies ITaskFailedPayload,
			});
			return false;
		}
	};

	private dispatchQueuedDirectWork = async (entry: IInboxEntry) => {
		if (this.options.inbox.get(entry.entryId)?.status !== 'queued') {
			return false;
		}
		if (entry.work.workKind !== 'direct') {
			this.options.inbox.transition(entry.entryId, 'dropped');
			return false;
		}
		const requestId = entry.work.payloadRef.requestId;
		const agentId = entry.toAgentId;
		const decision = this.options.triage.evaluate({
			toAgentId: entry.toAgentId,
			fromAgentId: entry.fromAgentId,
			requestId,
		});

		if (decision.action === 'drop') {
			this.options.inbox.transition(entry.entryId, 'dropped');
			this.clearDeferredDispatch(entry.entryId);
			return false;
		}

		if (decision.action !== 'deliver') {
			this.setDeferredDispatchBackoff(entry.entryId);
			return false;
		}
		this.clearDeferredDispatch(entry.entryId);

		const storedPayload = entry.payload as
			| (IDirectRequestPayload & { requesterConnectionId?: string })
			| undefined;
		if (!storedPayload) {
			this.options.inbox.transition(entry.entryId, 'dropped');
			this.clearDeferredDispatch(entry.entryId);
			return false;
		}

		this.options.inbox.transition(entry.entryId, 'reserved');
		const connectionId = this.options.mailbox.resolve(agentId);
		if (!connectionId) {
			this.options.inbox.transition(entry.entryId, 'queued');
			return false;
		}

		try {
			this.options.transitionWorkerState(agentId, {
				kind: 'focused',
				taskId: `direct:${requestId}`,
			});
		} catch {
			this.options.inbox.transition(entry.entryId, 'queued');
			return false;
		}

		try {
			await this.options.sendToConnection(connectionId, {
				type: DIRECT_REQUEST,
				channel: `direct:${requestId}`,
				payload:
					this.options.createForwardedDirectRequestPayload(storedPayload),
			});
			const current = this.options.inbox.get(entry.entryId);
			if (!current || current.status !== 'reserved') {
				this.completeWork({
					agentId,
					workKind: 'direct',
					workId: requestId,
					outcome: 'dropped',
				});
				return false;
			}
			this.options.inbox.transition(entry.entryId, 'dispatched');
			return true;
		} catch (error) {
			this.options.onDispatchFailureLog(
				`Failed to deliver queued message ${requestId}: ${error instanceof Error ? error.message : String(error)}`,
			);
			this.completeWork({
				agentId,
				workKind: 'direct',
				workId: requestId,
				outcome: 'dropped',
			});
			this.options.notificationService.notifyRequesterOfFailure(
				storedPayload,
				storedPayload,
			);
			return false;
		}
	};
}
