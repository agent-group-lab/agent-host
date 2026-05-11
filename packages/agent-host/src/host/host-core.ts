import type {
	CommitmentAction,
	IAgentEventEnvelope,
} from '@agent-group-lab/contracts/agent';
import type { ITransitionEvent } from '@agent-group-lab/contracts/events';
import type { HostMessageType } from '@agent-group-lab/contracts/messages';
import {
	AGENT_EVENT,
	COMMITMENT_ACTION,
	COMMITMENT_BREACHED,
	COMMITMENT_UPDATED,
	COORD_WAIT_DONE,
	COORD_WAIT_START,
	DIRECT_CANCEL,
	DIRECT_REQUEST,
	DIRECT_RESPONSE,
	type DirectReasonCode,
	getMessageEntry,
	type ICommitmentActionPayload,
	type ICommitmentBreachedPayload,
	type ICommitmentUpdatedPayload,
	type ICoordWaitDonePayload,
	type ICoordWaitStartPayload,
	type IDirectCancelPayload,
	type IDirectRequestPayload,
	type IDirectResponsePayload,
	type IInboxListPayload,
	type IMemberJoinPayload,
	type IMemberLeavePayload,
	type IMemberListPayload,
	type IMessageListPayload,
	type IMessagePostPayload,
	INBOX_LIST,
	type ITaskAssignPayload,
	type ITaskboardListPayload,
	type ITaskChildrenStatusPayload,
	type ITaskClaimPayload,
	type ITaskClaimPullPayload,
	type ITaskCompletedPayload,
	type ITaskDeliverPayload,
	type ITaskFailedPayload,
	type ITaskListPayload,
	type ITaskPublishBatchPayload,
	type IWorkerRegisterPayload,
	type IWorkersListPayload,
	MEMBER_JOIN,
	MEMBER_LEAVE,
	MEMBER_LIST,
	MESSAGE_LIST,
	MESSAGE_POST,
	TASK_ASSIGN,
	TASK_CHILDREN_STATUS,
	TASK_CLAIM,
	TASK_CLAIM_PULL,
	TASK_COMPLETED,
	TASK_DELIVER,
	TASK_FAILED,
	TASK_LIST,
	TASK_PUBLISH_BATCH,
	TASKBOARD_LIST,
	validatePayload,
	WORKER_REGISTER,
	WORKERS_LIST,
} from '@agent-group-lab/contracts/messages';
import type {
	IHostCheckpoint,
	IReplayCursor,
	ITimelineEntry,
} from '@agent-group-lab/contracts/timeline';
import type { WorkState } from '@agent-group-lab/contracts/work';
import type {
	IProtocolEnvelope,
	IProtocolTrace,
} from '@agent-group-lab/protocol';
import { nanoid } from 'nanoid';
import type { CommitmentStatus, ICommitmentRecord } from '~/domain/commitment';
import type { ITaskBoardEntry } from '~/domain/task-board';
import {
	formatWorkState,
	getTaskIdFromWorkState,
	transitionWork,
} from '~/domain/work-state';
import {
	DirectAdmissionGuard,
	type IDirectAdmissionGuard,
	type IDirectAdmissionGuardOptions,
} from '~/policy/direct-admission-guard';
import { type ITriage, RuleTriage } from '~/policy/triage';
import {
	type IEventOutputPort,
	noopEventOutputPort,
} from '~/ports/event-output-port';
import type { IHostPortConnection } from '~/ports/host-server-port';
import type {
	IConnectionMeta,
	IHostStore,
	IStoreSnapshot,
} from '~/store/store';
import { AgentEventHandler } from './handlers/agent-event-handler';
import { BreachHandler } from './handlers/breach-handler';
import { CommitmentHandler } from './handlers/commitment-handler';
import { ControlPlaneHandler } from './handlers/control-plane-handler';
import { CoordinationHandler } from './handlers/coordination-handler';
import { DirectHandler } from './handlers/direct-handler';
import { DispatchCoordinator } from './handlers/dispatch-coordinator';
import { InboxListHandler } from './handlers/inbox-list-handler';
import { MembershipHandler } from './handlers/membership-handler';
import { RoomMessageHandler } from './handlers/room-message-handler';
import { TaskChildrenStatusHandler } from './handlers/task-children-status-handler';
import { TaskClaimHandler } from './handlers/task-claim-handler';
import { TaskClaimPullHandler } from './handlers/task-claim-pull-handler';
import { TaskDeliverHandler } from './handlers/task-deliver-handler';
import { TaskHandler } from './handlers/task-handler';
import { TaskListHandler } from './handlers/task-list-handler';
import { TaskPublishBatchHandler } from './handlers/task-publish-batch-handler';
import { TaskboardListHandler } from './handlers/taskboard-list-handler';
import { WorkerRegistryHandler } from './handlers/worker-registry-handler';
import { BreachDetector } from './infra/breach-detector';
import { ClaimLeaseReaper } from './infra/claim-lease-reaper';
import {
	ConnectionManager,
	type IConnectionContext,
} from './infra/connection-manager';
import { type IInbox, StoreBackedInbox } from './infra/inbox';
import { type IMailbox, StoreBackedMailbox } from './infra/mailbox';
import { type IMessageGateway, MessageGateway } from './infra/message-gateway';
import { AgreementService } from './services/agreement-service';
import { SessionExecutionService } from './services/session-execution-service';
import { TaskBoardService } from './services/task-board-service';
import { TaskNotificationService } from './services/task-notification-service';
import { WorkQueueService } from './services/work-queue-service';
import { WorkerLifecycleService } from './services/worker-lifecycle-service';

interface IBreachDetectionOptions {
	enabled?: boolean;
	now?: () => number;
	reason?: string;
}

interface IWorkTransitionMetadata extends Record<string, unknown> {
	taskId?: string;
	toolName?: string;
	toAgentId?: string;
	requestId?: string;
}

const buildWorkTransitionMetadata = (
	previous: WorkState,
	next: WorkState,
): IWorkTransitionMetadata => {
	const taskId =
		getTaskIdFromWorkState(next) ?? getTaskIdFromWorkState(previous);
	const metadata: IWorkTransitionMetadata = {};
	if (taskId) {
		metadata.taskId = taskId;
	}

	switch (next.kind) {
		case 'waiting_tool':
		case 'waiting_delegation':
			metadata.toolName = next.toolName;
			break;
		case 'waiting_peer':
			metadata.toAgentId = next.toAgentId;
			metadata.requestId = next.requestId;
			break;
		default:
			break;
	}

	return metadata;
};

type IHostCommandPayload =
	| IWorkerRegisterPayload
	| IWorkersListPayload
	| ITaskAssignPayload
	| ITaskPublishBatchPayload
	| ITaskClaimPayload
	| ITaskClaimPullPayload
	| ICoordWaitStartPayload
	| ICoordWaitDonePayload
	| ITaskChildrenStatusPayload
	| ITaskListPayload
	| ITaskboardListPayload
	| IAgentEventEnvelope
	| ITaskCompletedPayload
	| ITaskDeliverPayload
	| ITaskFailedPayload
	| ICommitmentActionPayload
	| IDirectRequestPayload
	| IDirectResponsePayload
	| IDirectCancelPayload
	| IInboxListPayload
	| IMessagePostPayload
	| IMessageListPayload
	| IMemberJoinPayload
	| IMemberLeavePayload
	| IMemberListPayload;

interface IHostDispatchInput {
	context: IConnectionContext;
	payload: IHostCommandPayload;
	trace: IProtocolTrace | undefined;
	messageTs: number;
}

type IHostDispatchHandler = (input: IHostDispatchInput) => Promise<void>;

export interface IHostCoreOptions {
	store: IHostStore;
	onLog?: (message: string) => void;
	mailbox?: IMailbox;
	inbox?: IInbox;
	triage?: ITriage;
	directAdmissionGuard?: IDirectAdmissionGuard;
	directAdmission?: IDirectAdmissionGuardOptions;
	breachDetection?: IBreachDetectionOptions;
	taskClaimV2Enabled?: boolean;
	preferredHoldMs?: number;
	eventOutputPort?: IEventOutputPort;
}

export interface ICallerContext {
	agentId: string;
	agentName: string;
	workerType: 'session';
	adapterId?: string;
}

interface IHandleConnectionInput {
	callerContext?: ICallerContext;
}

const maxClaimRetries = 5;
const sessionIdleOfflineTtlMs = 5 * 60_000;
const sessionOfflineRetentionTtlMs = 10 * 60_000;

export class HostCore {
	private readonly options: IHostCoreOptions;
	private readonly store: IHostStore;
	private readonly mailbox: IMailbox;
	private readonly inbox: IInbox;
	private readonly triage: ITriage;
	private readonly directAdmissionGuard: IDirectAdmissionGuard;
	private readonly breachDetector?: BreachDetector;
	private readonly claimLeaseReaper?: ClaimLeaseReaper;
	private readonly taskClaimV2Enabled: boolean;
	private readonly preferredHoldMs: number;
	private readonly dispatchCoordinator: DispatchCoordinator;
	private readonly connectionManager: ConnectionManager;
	private readonly messageGateway: IMessageGateway;
	private readonly eventOutputPort: IEventOutputPort;
	private readonly controlPlaneHandler: ControlPlaneHandler;
	private readonly workerRegistryHandler: WorkerRegistryHandler;
	private readonly agentEventHandler: AgentEventHandler;
	private readonly taskHandler: TaskHandler;
	private readonly commitmentHandler: CommitmentHandler;
	private readonly directHandler: DirectHandler;
	private readonly inboxListHandler: InboxListHandler;
	private readonly membershipHandler: MembershipHandler;
	private readonly roomMessageHandler: RoomMessageHandler;
	private readonly taskPublishBatchHandler: TaskPublishBatchHandler;
	private readonly taskClaimHandler: TaskClaimHandler;
	private readonly taskClaimPullHandler: TaskClaimPullHandler;
	private readonly taskDeliverHandler: TaskDeliverHandler;
	private readonly coordinationHandler: CoordinationHandler;
	private readonly taskChildrenStatusHandler: TaskChildrenStatusHandler;
	private readonly taskListHandler: TaskListHandler;
	private readonly taskboardListHandler: TaskboardListHandler;
	private readonly breachHandler: BreachHandler;
	private readonly breachReason: string;
	private readonly taskBoardService: TaskBoardService;
	private readonly agreementService: AgreementService;
	private readonly sessionExecutionService: SessionExecutionService;
	private readonly workQueueService: WorkQueueService;
	private readonly notificationService: TaskNotificationService;
	private readonly workerLifecycleService: WorkerLifecycleService;
	private sessionId: string;
	private sessionStartedAt: number;
	private timelineSeq = 0;
	private readonly handlerMap: ReadonlyMap<
		HostMessageType,
		IHostDispatchHandler
	>;

	constructor(options: IHostCoreOptions) {
		this.options = options;
		this.store = options.store;
		this.sessionStartedAt = Date.now();
		this.sessionId = `session_${nanoid(10)}`;
		this.taskClaimV2Enabled = options.taskClaimV2Enabled ?? false;
		this.preferredHoldMs = options.preferredHoldMs ?? 5_000;
		this.connectionManager = new ConnectionManager(this.store);
		this.eventOutputPort = options.eventOutputPort ?? noopEventOutputPort;
		this.messageGateway = new MessageGateway({
			nextSeq: this.store.nextSeq,
			getLiveConnection: this.connectionManager.getLiveConnection,
		});
		this.controlPlaneHandler = new ControlPlaneHandler({
			messageGateway: this.messageGateway,
			updateConnectionMeta: this.updateConnectionMeta,
			log: this.log,
		});
		this.workerRegistryHandler = new WorkerRegistryHandler({
			store: this.store,
			getMember: this.store.getMember,
			setMember: this.store.setMember,
			messageGateway: this.messageGateway,
			onTransitionEvents: this.onTransitionEvents,
			updateConnectionMeta: this.updateConnectionMeta,
			logWorkerTransition: this.logWorkerTransition,
			markWorkerOffline: this.markWorkerOffline,
			deleteWorker: this.store.deleteWorker,
			hasActiveWorkerReferences: this.hasActiveWorkerReferences,
			log: this.log,
		});
		this.agentEventHandler = new AgentEventHandler({
			store: this.store,
			messageGateway: this.messageGateway,
			transitionWorkerState: this.transitionWorkerState,
			onAgentEvent: (payload) => this.eventOutputPort.onAgentEvent?.(payload),
			onTimelineEntry: this.emitTimelineEntry,
			nextTimelineSeq: this.nextTimelineSeq,
			getSessionId: () => this.sessionId,
			now: Date.now,
			log: this.log,
		});
		this.mailbox = options.mailbox ?? new StoreBackedMailbox(this.store);
		this.inbox = options.inbox ?? new StoreBackedInbox(this.store);
		this.triage =
			options.triage ??
			new RuleTriage({
				getWorkState: (agentId) =>
					this.store.getWorker(agentId)?.workState.kind ?? 'offline',
				getQueuedCount: (agentId) =>
					this.inbox.getDispatchCandidates(agentId).length,
			});
		this.directAdmissionGuard =
			options.directAdmissionGuard ??
			new DirectAdmissionGuard(options.directAdmission);

		// Services
		this.taskBoardService = new TaskBoardService({
			store: this.store,
			onTransitionEvents: this.onTransitionEvents,
		});
		this.agreementService = new AgreementService({
			store: this.store,
			onTransitionEvents: this.onTransitionEvents,
		});
		this.sessionExecutionService = new SessionExecutionService({
			store: this.store,
			agreementService: this.agreementService,
			taskBoardService: this.taskBoardService,
			transitionWorkerState: this.transitionWorkerState,
			sendToConnection: this.messageGateway.sendToConnection,
		});
		this.workQueueService = new WorkQueueService({
			store: this.store,
			inbox: this.inbox,
			clearDeferredDispatch: (entryId) => {
				this.dispatchCoordinator.clearDeferredDispatch(entryId);
			},
			restoreRequesterWorkState: this.restoreRequesterWorkState,
			sendToConnection: this.messageGateway.sendToConnection,
			sendHostAck: this.sendHostAck,
			log: this.log,
		});
		this.notificationService = new TaskNotificationService({
			store: this.store,
			mailbox: this.mailbox,
			workQueueService: this.workQueueService,
			sendToConnection: this.messageGateway.sendToConnection,
			sendHostAck: this.sendHostAck,
			completeWork: (input) => {
				this.dispatchCoordinator.completeWork(input);
			},
			log: this.log,
		});
		this.workerLifecycleService = new WorkerLifecycleService({
			store: this.store,
			taskBoardService: this.taskBoardService,
			workQueueService: this.workQueueService,
			transitionWorkerState: this.transitionWorkerState,
			forceWorkerState: this.forceWorkerState,
			dispatchNextWorkForWorker: this.dispatchNextWorkForWorker,
			sendToConnection: this.messageGateway.sendToConnection,
			log: this.log,
		});

		this.dispatchCoordinator = new DispatchCoordinator({
			inbox: this.inbox,
			store: this.store,
			mailbox: this.mailbox,
			triage: this.triage,
			getLiveConnection: (connectionId) => {
				return this.connectionManager.getConnection(connectionId);
			},
			createEnvelope: this.messageGateway.createEnvelope,
			sendToConnection: this.messageGateway.sendToConnection,
			transitionWorkerState: this.transitionWorkerState,
			markWorkerOffline: this.markWorkerOffline,
			createTaskAssignPayload: this.createTaskAssignPayload,
			createForwardedDirectRequestPayload:
				this.createForwardedDirectRequestPayload,
			taskBoardService: this.taskBoardService,
			notificationService: this.notificationService,
			workerLifecycleService: this.workerLifecycleService,
			onDispatchFailureLog: this.log,
		});
		this.taskHandler = new TaskHandler({
			store: this.store,
			taskClaimV2Enabled: this.taskClaimV2Enabled,
			getLiveConnection: this.connectionManager.getLiveConnection,
			sendProtocolError: this.messageGateway.sendProtocolError,
			updateConnectionMeta: this.updateConnectionMeta,
			markWorkerOffline: this.markWorkerOffline,
			taskBoardService: this.taskBoardService,
			notificationService: this.notificationService,
			workQueueService: this.workQueueService,
			dispatchNextWorkForWorker: this.dispatchNextWorkForWorker,
			sendToConnection: this.messageGateway.sendToConnection,
		});
		this.commitmentHandler = new CommitmentHandler({
			store: this.store,
			getLiveConnection: this.connectionManager.getLiveConnection,
			taskBoardService: this.taskBoardService,
			agreementService: this.agreementService,
			notificationService: this.notificationService,
			workQueueService: this.workQueueService,
			workerLifecycleService: this.workerLifecycleService,
			publishCommitmentUpdated: async (task, agentId, action, status) => {
				try {
					await this.publishCommitmentUpdated(task, agentId, action, status);
				} catch (error) {
					this.log(
						`Failed to publish commitment update for ${task.taskId} on ${action}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			},
			sendProtocolError: this.messageGateway.sendProtocolError,
			sendToConnection: this.messageGateway.sendToConnection,
			dispatchNextWorkForWorker: this.dispatchNextWorkForWorker,
		});
		this.directHandler = new DirectHandler({
			inbox: this.inbox,
			mailbox: this.mailbox,
			triage: this.triage,
			directAdmissionGuard: this.directAdmissionGuard,
			sendProtocolError: this.messageGateway.sendProtocolError,
			sendToConnection: this.messageGateway.sendToConnection,
			sendHostAck: this.sendHostAck,
			markWorkerWaitingPeer: this.markWorkerWaitingPeer,
			restoreRequesterWorkState: this.restoreRequesterWorkState,
			resolveRequesterConnection: this.resolveRequesterConnection,
			completeWork: this.completeWork,
			dispatchNextWorkForWorker: this.dispatchNextWorkForWorker,
			log: this.log,
		});
		this.inboxListHandler = new InboxListHandler({
			store: this.store,
			sendProtocolError: this.messageGateway.sendProtocolError,
			sendToConnection: this.messageGateway.sendToConnection,
		});
		this.membershipHandler = new MembershipHandler({
			store: this.store,
			messageGateway: this.messageGateway,
			onTransitionEvents: this.onTransitionEvents,
			log: this.log,
		});
		this.roomMessageHandler = new RoomMessageHandler({
			store: this.store,
			sendProtocolError: this.messageGateway.sendProtocolError,
			sendToConnection: this.messageGateway.sendToConnection,
		});
		this.taskPublishBatchHandler = new TaskPublishBatchHandler({
			store: this.store,
			taskClaimV2Enabled: this.taskClaimV2Enabled,
			taskBoardService: this.taskBoardService,
			workQueueService: this.workQueueService,
			sendProtocolError: this.messageGateway.sendProtocolError,
			sendToConnection: this.messageGateway.sendToConnection,
			dispatchNextWorkForWorker: this.dispatchNextWorkForWorker,
		});
		this.taskClaimHandler = new TaskClaimHandler({
			store: this.store,
			taskClaimV2Enabled: this.taskClaimV2Enabled,
			preferredHoldMs: this.preferredHoldMs,
			sendProtocolError: this.messageGateway.sendProtocolError,
			sendToConnection: this.messageGateway.sendToConnection,
			workQueueService: this.workQueueService,
			dispatchNextWorkForWorker: this.dispatchNextWorkForWorker,
		});
		this.taskClaimPullHandler = new TaskClaimPullHandler({
			store: this.store,
			preferredHoldMs: this.preferredHoldMs,
			sendProtocolError: this.messageGateway.sendProtocolError,
			sendToConnection: this.messageGateway.sendToConnection,
			sessionExecutionService: this.sessionExecutionService,
		});
		this.taskDeliverHandler = new TaskDeliverHandler({
			store: this.store,
			sendProtocolError: this.messageGateway.sendProtocolError,
			sendToConnection: this.messageGateway.sendToConnection,
			taskBoardService: this.taskBoardService,
			agreementService: this.agreementService,
			notificationService: this.notificationService,
			dispatchNextWorkForWorker: this.dispatchNextWorkForWorker,
			transitionWorkerState: this.transitionWorkerState,
			forceWorkerState: this.forceWorkerState,
		});
		this.coordinationHandler = new CoordinationHandler({
			sendProtocolError: this.messageGateway.sendProtocolError,
			transitionWorkerState: this.transitionWorkerState,
			resolveCurrentTaskId: (agentId: string) => {
				const worker = this.store.getWorker(agentId);
				if (!worker) {
					return undefined;
				}
				return getTaskIdFromWorkState(worker.workState);
			},
			log: this.log,
		});
		this.taskChildrenStatusHandler = new TaskChildrenStatusHandler({
			store: this.store,
			taskClaimV2Enabled: this.taskClaimV2Enabled,
			sendProtocolError: this.messageGateway.sendProtocolError,
			sendToConnection: this.messageGateway.sendToConnection,
			log: this.log,
		});
		this.taskListHandler = new TaskListHandler({
			store: this.store,
			sendProtocolError: this.messageGateway.sendProtocolError,
			sendToConnection: this.messageGateway.sendToConnection,
		});
		this.taskboardListHandler = new TaskboardListHandler({
			store: this.store,
			sendProtocolError: this.messageGateway.sendProtocolError,
			sendToConnection: this.messageGateway.sendToConnection,
			log: this.log,
		});
		this.handlerMap = this.createHandlerMap();
		this.breachReason =
			options.breachDetection?.reason ?? 'SLA deadline exceeded';
		this.breachHandler = new BreachHandler({
			store: this.store,
			breachReason: this.breachReason,
			agreementService: this.agreementService,
			taskBoardService: this.taskBoardService,
			notificationService: this.notificationService,
			messageGateway: this.messageGateway,
		});
		if (options.breachDetection?.enabled) {
			this.breachDetector = new BreachDetector({
				store: this.store,
				now: options.breachDetection.now,
				onBreach: async (commitment) => {
					await this.breachHandler.handleCommitmentBreached(commitment);
				},
			});
		}
		if (this.taskClaimV2Enabled) {
			this.claimLeaseReaper = this.createClaimLeaseReaper();
		}
	}

	close = async () => {};

	runMaintenance = async () => {
		const now = Date.now();
		this.store.deleteExpiredRoomMessages(now);
		await this.claimLeaseReaper?.scanOnce();
		await this.breachDetector?.scanOnce();
		const justOfflinedWorkerIds =
			this.workerRegistryHandler.reapInactiveSessionWorkers({
				now,
				ttlMs: sessionIdleOfflineTtlMs,
			});
		const justDeletedWorkerIds =
			this.workerRegistryHandler.reapInactiveOfflineWorkers({
				now,
				ttlMs: sessionOfflineRetentionTtlMs,
				excludeAgentIds: justOfflinedWorkerIds,
			});
		this.membershipHandler.deleteMembers({
			workerIds: justDeletedWorkerIds,
		});
		this.membershipHandler.deleteMembersWithoutWorkers({
			workerIds: this.store.listWorkers().map((worker) => worker.agentId),
		});
	};

	getNextMaintenanceAt = (now = Date.now()) => {
		const snapshot = this.store.snapshot();
		const memberIds = new Set(snapshot.members.map((member) => member.agentId));
		const workersById = new Map(
			snapshot.workers.map((worker) => [worker.agentId, worker]),
		);
		const activeReferenceAgentIds = this.getActiveReferenceAgentIds(snapshot);
		const acceptedCommitmentTaskIds = new Set(
			snapshot.commitments
				.filter((commitment) => commitment.status === 'accepted')
				.map((commitment) => commitment.taskId),
		);
		let nextAt: number | undefined;

		const updateNextAt = (candidate: number | undefined) => {
			if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
				return;
			}
			const normalized = Math.max(now, candidate);
			nextAt = nextAt === undefined ? normalized : Math.min(nextAt, normalized);
		};

		for (const worker of snapshot.workers) {
			if (worker.workerType !== 'session') {
				continue;
			}
			if (worker.workState.kind === 'idle') {
				updateNextAt(worker.lastSeenAt + sessionIdleOfflineTtlMs);
				continue;
			}
			if (
				worker.workState.kind === 'offline' &&
				memberIds.has(worker.agentId) &&
				!activeReferenceAgentIds.has(worker.agentId)
			) {
				updateNextAt(worker.lastSeenAt + sessionOfflineRetentionTtlMs);
				continue;
			}
			if (
				worker.workState.kind === 'offline' &&
				!memberIds.has(worker.agentId) &&
				!activeReferenceAgentIds.has(worker.agentId)
			) {
				updateNextAt(worker.lastSeenAt + sessionOfflineRetentionTtlMs);
			}
		}
		for (const member of snapshot.members) {
			if (!workersById.has(member.agentId)) {
				updateNextAt(now);
			}
		}

		if (this.taskClaimV2Enabled) {
			for (const task of snapshot.taskBoard) {
				if (
					task.status === 'todo' &&
					task.dispatchMode === 'claim' &&
					task.assigneeId &&
					typeof task.claimLeaseExpiresAt === 'number' &&
					!acceptedCommitmentTaskIds.has(task.taskId)
				) {
					updateNextAt(task.claimLeaseExpiresAt);
				}
				if (
					task.status === 'doing' &&
					task.assigneeId &&
					typeof task.executionLeaseExpiresAt === 'number' &&
					workersById.get(task.assigneeId)?.workerType === 'session'
				) {
					updateNextAt(task.executionLeaseExpiresAt);
				}
			}
		}

		if (this.breachDetector) {
			for (const commitment of snapshot.commitments) {
				if (
					commitment.status === 'accepted' &&
					typeof commitment.slaDeadline === 'number'
				) {
					updateNextAt(commitment.slaDeadline);
				}
			}
		}

		for (const message of snapshot.roomMessages) {
			if (typeof message.expiresAt === 'number') {
				updateNextAt(message.expiresAt);
			}
		}
		return nextAt;
	};

	checkpoint = () => {
		const now = Date.now();
		return {
			snapshot: this.store.snapshot(),
			cursor: {
				sessionId: this.sessionId,
				sessionStartedAt: this.sessionStartedAt,
				timelineSeq: this.timelineSeq,
				ts: now,
			},
		} satisfies IHostCheckpoint<IStoreSnapshot>;
	};

	restoreSessionCursor = (
		cursor: Pick<
			IReplayCursor,
			'sessionId' | 'sessionStartedAt' | 'timelineSeq'
		>,
	) => {
		this.sessionId = cursor.sessionId;
		this.sessionStartedAt = cursor.sessionStartedAt;
		this.timelineSeq = cursor.timelineSeq;
	};

	handleConnection = (
		connection: IHostPortConnection,
		input?: IHandleConnectionInput,
	) => {
		this.connectionManager.open(connection);
		if (input?.callerContext) {
			this.updateConnectionMeta(connection.id, {
				connectionRole: 'worker',
				agentId: input.callerContext.agentId,
			});
		}
		this.log(`Connection opened: ${connection.id}`);
	};

	rehydrateConnection = (
		connection: IHostPortConnection,
		meta?: IConnectionMeta,
	) => {
		this.connectionManager.rehydrate(connection, meta);
		this.log(`Connection rehydrated: ${connection.id}`);
	};

	handleMessage = async (
		connection: IHostPortConnection,
		message: IProtocolEnvelope<string, unknown>,
	) => {
		const context = this.getConnectionContext(connection.id);
		if (!context) {
			return;
		}

		if (message.type.startsWith('control:')) {
			await this.handleControlMessage(context, message);
			return;
		}

		if (!context.meta.ready) {
			await this.messageGateway.sendProtocolError(
				context.live.connection,
				'protocol',
				'Connection is not ready. Send control:hello first.',
			);
			return;
		}

		const entry = getMessageEntry(message.type);
		if (
			!entry ||
			entry.category !== 'command' ||
			!this.handlerMap.has(message.type as HostMessageType)
		) {
			await this.messageGateway.sendProtocolError(
				context.live.connection,
				'protocol',
				`Unsupported message type: ${message.type}`,
			);
			return;
		}

		const parsed = validatePayload(message.type, message.payload);
		if (!parsed.success) {
			await this.messageGateway.sendProtocolError(
				context.live.connection,
				'protocol',
				`Invalid ${message.type} payload`,
				parsed.error.flatten(),
			);
			return;
		}

		const handler = this.handlerMap.get(message.type as HostMessageType);
		if (!handler) {
			await this.messageGateway.sendProtocolError(
				context.live.connection,
				'protocol',
				`Unsupported message type: ${message.type}`,
			);
			return;
		}

		await handler({
			context,
			payload: parsed.data as IHostCommandPayload,
			trace: message.trace,
			messageTs: message.ts,
		});
	};

	handleDisconnect = async (
		connection: IHostPortConnection,
		hadError: boolean,
	) => {
		const context = this.connectionManager.close(connection.id);
		if (!context) {
			return;
		}

		this.log(
			`Connection closed: ${connection.id}${hadError ? ' (error)' : ''}`,
		);

		if (!context.meta.agentId) {
			return;
		}

		const worker = this.store.getWorker(context.meta.agentId);
		if (!worker) {
			return;
		}
		if (worker.workerType === 'session') {
			return;
		}

		const runningTaskId = getTaskIdFromWorkState(worker.workState);
		this.markWorkerOffline(worker.agentId);
		await this.workerLifecycleService.handleWorkerDisconnect({
			agentId: worker.agentId,
			runningTaskId: runningTaskId ?? undefined,
		});
	};

	handleTransportError = async (error: unknown) => {
		const message =
			error instanceof Error ? error.message : 'Unknown host error';
		this.log(`[error] ${message}`);
	};

	private handleControlMessage = async (
		context: IConnectionContext,
		message: IProtocolEnvelope<string, unknown>,
	) => {
		await this.controlPlaneHandler.handleControlMessage(context, message);
	};

	private createHandlerMap = (): ReadonlyMap<
		HostMessageType,
		IHostDispatchHandler
	> => {
		return new Map<HostMessageType, IHostDispatchHandler>([
			[
				WORKER_REGISTER,
				async ({ context, payload }) => {
					await this.handleWorkerRegister(
						context,
						payload as IWorkerRegisterPayload,
					);
				},
			],
			[
				WORKERS_LIST,
				async ({ context, payload }) => {
					await this.handleWorkersList(context, payload as IWorkersListPayload);
				},
			],
			[
				INBOX_LIST,
				async ({ context, payload }) => {
					await this.handleInboxList(context, payload as IInboxListPayload);
				},
			],
			[
				MESSAGE_POST,
				async ({ context, payload }) => {
					await this.handleMessagePost(context, payload as IMessagePostPayload);
				},
			],
			[
				MESSAGE_LIST,
				async ({ context, payload }) => {
					await this.handleMessageList(context, payload as IMessageListPayload);
				},
			],
			[
				MEMBER_JOIN,
				async ({ context, payload }) => {
					await this.handleMemberJoin(context, payload as IMemberJoinPayload);
				},
			],
			[
				MEMBER_LEAVE,
				async ({ context, payload }) => {
					await this.handleMemberLeave(context, payload as IMemberLeavePayload);
				},
			],
			[
				MEMBER_LIST,
				async ({ context, payload }) => {
					await this.handleMemberList(context, payload as IMemberListPayload);
				},
			],
			[
				TASK_ASSIGN,
				async ({ context, payload }) => {
					await this.handleTaskAssign(context, payload as ITaskAssignPayload);
				},
			],
			[
				TASK_PUBLISH_BATCH,
				async ({ context, payload }) => {
					await this.handleTaskPublishBatch(
						context,
						payload as ITaskPublishBatchPayload,
					);
				},
			],
			[
				TASK_CLAIM,
				async ({ context, payload }) => {
					await this.handleTaskClaim(context, payload as ITaskClaimPayload);
				},
			],
			[
				TASK_CLAIM_PULL,
				async ({ context, payload }) => {
					await this.handleTaskClaimPull(
						context,
						payload as ITaskClaimPullPayload,
					);
				},
			],
			[
				COORD_WAIT_START,
				async ({ context, payload }) => {
					await this.handleCoordWaitStart(
						context,
						payload as ICoordWaitStartPayload,
					);
				},
			],
			[
				COORD_WAIT_DONE,
				async ({ context, payload }) => {
					await this.handleCoordWaitDone(
						context,
						payload as ICoordWaitDonePayload,
					);
				},
			],
			[
				TASK_CHILDREN_STATUS,
				async ({ context, payload }) => {
					await this.handleTaskChildrenStatus(
						context,
						payload as ITaskChildrenStatusPayload,
					);
				},
			],
			[
				TASK_LIST,
				async ({ context, payload }) => {
					await this.handleTaskList(context, payload as ITaskListPayload);
				},
			],
			[
				TASKBOARD_LIST,
				async ({ context, payload }) => {
					await this.handleTaskboardList(
						context,
						payload as ITaskboardListPayload,
					);
				},
			],
			[
				AGENT_EVENT,
				async ({ context, payload }) => {
					await this.handleAgentEvent(context, payload as IAgentEventEnvelope);
				},
			],
			[
				TASK_COMPLETED,
				async ({ context, payload }) => {
					await this.handleTaskCompleted(
						context,
						payload as ITaskCompletedPayload,
					);
				},
			],
			[
				TASK_DELIVER,
				async ({ context, payload }) => {
					await this.handleTaskDeliver(context, payload as ITaskDeliverPayload);
				},
			],
			[
				TASK_FAILED,
				async ({ context, payload }) => {
					await this.handleTaskFailed(context, payload as ITaskFailedPayload);
				},
			],
			[
				COMMITMENT_ACTION,
				async ({ context, payload }) => {
					await this.handleCommitmentAction(
						context,
						payload as ICommitmentActionPayload,
					);
				},
			],
			[
				DIRECT_REQUEST,
				async ({ context, payload, trace, messageTs }) => {
					await this.handleDirectRequest(
						context,
						payload as IDirectRequestPayload,
						trace,
						messageTs,
					);
				},
			],
			[
				DIRECT_RESPONSE,
				async ({ context, payload, trace }) => {
					await this.handleDirectResponse(
						context,
						payload as IDirectResponsePayload,
						trace,
					);
				},
			],
			[
				DIRECT_CANCEL,
				async ({ context, payload }) => {
					await this.handleDirectCancel(
						context,
						payload as IDirectCancelPayload,
					);
				},
			],
		]);
	};

	private handleWorkerRegister = async (
		context: IConnectionContext,
		payload: IWorkerRegisterPayload,
	) => {
		await this.workerRegistryHandler.handleWorkerRegister(context, payload);
	};

	private handleWorkersList = async (
		context: IConnectionContext,
		payload: IWorkersListPayload,
	) => {
		await this.workerRegistryHandler.handleWorkersList(context, payload);
	};

	private handleTaskAssign = async (
		context: IConnectionContext,
		payload: ITaskAssignPayload,
	) => {
		await this.taskHandler.handleTaskAssign(context, payload);
	};

	private handleMemberJoin = async (
		context: IConnectionContext,
		payload: IMemberJoinPayload,
	) => {
		await this.membershipHandler.handleMemberJoin(context, payload);
	};

	private handleMessagePost = async (
		context: IConnectionContext,
		payload: IMessagePostPayload,
	) => {
		await this.roomMessageHandler.handleMessagePost(context, payload);
	};

	private handleMessageList = async (
		context: IConnectionContext,
		payload: IMessageListPayload,
	) => {
		await this.roomMessageHandler.handleMessageList(context, payload);
	};

	private handleInboxList = async (
		context: IConnectionContext,
		payload: IInboxListPayload,
	) => {
		await this.inboxListHandler.handleInboxList(context, payload);
	};

	private handleMemberLeave = async (
		context: IConnectionContext,
		payload: IMemberLeavePayload,
	) => {
		await this.membershipHandler.handleMemberLeave(context, payload);
	};

	private handleMemberList = async (
		context: IConnectionContext,
		payload: IMemberListPayload,
	) => {
		await this.membershipHandler.handleMemberList(context, payload);
	};

	private handleTaskPublishBatch = async (
		context: IConnectionContext,
		payload: ITaskPublishBatchPayload,
	) => {
		await this.taskPublishBatchHandler.handleTaskPublishBatch(context, payload);
	};

	private handleTaskClaim = async (
		context: IConnectionContext,
		payload: ITaskClaimPayload,
	) => {
		await this.taskClaimHandler.handleTaskClaim(context, payload);
	};

	private handleCoordWaitStart = async (
		context: IConnectionContext,
		payload: ICoordWaitStartPayload,
	) => {
		await this.coordinationHandler.handleCoordWaitStart(context, payload);
	};

	private handleCoordWaitDone = async (
		context: IConnectionContext,
		payload: ICoordWaitDonePayload,
	) => {
		await this.coordinationHandler.handleCoordWaitDone(context, payload);
	};

	private handleTaskChildrenStatus = async (
		context: IConnectionContext,
		payload: ITaskChildrenStatusPayload,
	) => {
		await this.taskChildrenStatusHandler.handleTaskChildrenStatus(
			context,
			payload,
		);
	};

	private handleTaskList = async (
		context: IConnectionContext,
		payload: ITaskListPayload,
	) => {
		await this.taskListHandler.handleTaskList(context, payload);
	};

	private handleTaskboardList = async (
		context: IConnectionContext,
		payload: ITaskboardListPayload,
	) => {
		await this.taskboardListHandler.handleTaskboardList(context, payload);
	};

	private handleAgentEvent = async (
		context: IConnectionContext,
		payload: IAgentEventEnvelope,
	) => {
		await this.agentEventHandler.handleAgentEvent(context, payload);
	};

	private handleTaskCompleted = async (
		context: IConnectionContext,
		payload: ITaskCompletedPayload,
	) => {
		await this.taskHandler.handleTaskCompleted(context, payload);
	};

	private handleTaskClaimPull = async (
		context: IConnectionContext,
		payload: ITaskClaimPullPayload,
	) => {
		await this.taskClaimPullHandler.handleTaskClaimPull(context, payload);
	};

	private handleTaskDeliver = async (
		context: IConnectionContext,
		payload: ITaskDeliverPayload,
	) => {
		await this.taskDeliverHandler.handleTaskDeliver(context, payload);
	};

	private handleTaskFailed = async (
		context: IConnectionContext,
		payload: ITaskFailedPayload,
	) => {
		await this.taskHandler.handleTaskFailed(context, payload);
	};

	private handleCommitmentAction = async (
		context: IConnectionContext,
		payload: ICommitmentActionPayload,
	) => {
		await this.commitmentHandler.handleCommitmentAction(context, payload);
	};

	private handleDirectRequest = async (
		context: IConnectionContext,
		payload: IDirectRequestPayload,
		trace: IProtocolTrace | undefined,
		messageTs: number,
	) => {
		await this.directHandler.handleDirectRequest(
			context,
			payload,
			trace,
			messageTs,
		);
	};

	private handleDirectResponse = async (
		context: IConnectionContext,
		payload: IDirectResponsePayload,
		trace: IProtocolTrace | undefined,
	) => {
		await this.directHandler.handleDirectResponse(context, payload, trace);
	};

	private handleDirectCancel = async (
		context: IConnectionContext,
		payload: IDirectCancelPayload,
	) => {
		await this.directHandler.handleDirectCancel(context, payload);
	};

	private createForwardedDirectRequestPayload = (
		payload: IDirectRequestPayload,
	): IDirectRequestPayload => {
		const nextChain = [...(payload.requestChain ?? [])];
		if (nextChain[nextChain.length - 1] !== payload.fromAgentId) {
			nextChain.push(payload.fromAgentId);
		}
		return {
			...payload,
			hopCount: (payload.hopCount ?? 0) + 1,
			requestChain: nextChain,
		};
	};

	private publishCommitmentUpdated = async (
		task: { taskId: string; turnId: string; requesterConnectionId: string },
		agentId: string,
		action: CommitmentAction,
		status: CommitmentStatus,
	) => {
		const payload: ICommitmentUpdatedPayload = {
			taskId: task.taskId,
			agentId,
			agentName: this.resolveAgentName(agentId),
			action,
			status,
		};
		await this.messageGateway.sendToConnection(task.requesterConnectionId, {
			type: COMMITMENT_UPDATED,
			channel: `task:${task.taskId}`,
			trace: {
				taskId: task.taskId,
				turnId: task.turnId,
			},
			payload,
		});
	};

	private publishCommitmentBreached = async (
		commitment: ICommitmentRecord,
		reason: string,
	) => {
		const taskBoard = this.store.getTaskBoardEntry(commitment.taskId);
		const requesterConnectionId = taskBoard?.requesterConnectionId;
		const trace =
			taskBoard !== undefined
				? {
						taskId: taskBoard.taskId,
						turnId: taskBoard.turnId,
					}
				: undefined;
		const payload: ICommitmentBreachedPayload = {
			taskId: commitment.taskId,
			agentId: commitment.assigneeId,
			agentName: this.resolveAgentName(commitment.assigneeId),
			reason,
		};

		if (requesterConnectionId) {
			await this.messageGateway.sendToConnection(requesterConnectionId, {
				type: COMMITMENT_BREACHED,
				channel: `task:${commitment.taskId}`,
				trace,
				payload,
			});
		}

		const workerConnectionId = this.mailbox.resolve(commitment.assigneeId);
		if (workerConnectionId && workerConnectionId !== requesterConnectionId) {
			await this.messageGateway.sendToConnection(workerConnectionId, {
				type: COMMITMENT_BREACHED,
				channel: `task:${commitment.taskId}`,
				trace,
				payload,
			});
		}
	};

	private emitTimelineEntry = (entry: ITimelineEntry) => {
		try {
			this.eventOutputPort.onTimeline?.(entry, this.sessionStartedAt);
		} catch (error) {
			this.log(
				`onTimeline consumer error: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

	private onTransitionEvents = (events: ITransitionEvent[]) => {
		try {
			this.eventOutputPort.onTransitionEvents(events);
		} catch (error) {
			this.log(
				`onTransitionEvents consumer error: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		this.emitTimelineEntry({
			sessionId: this.sessionId,
			timelineSeq: this.nextTimelineSeq(),
			ts: Date.now(),
			kind: 'transition',
			transitionEvent: events[1] ?? events[0] ?? null,
		});

		for (const event of events) {
			if (event.eventType !== 'commitment:status_changed') {
				continue;
			}
			const commitment = this.store.getCommitment(event.aggregateId);
			if (!commitment) {
				continue;
			}
			const task = this.store.getTaskBoardEntry(commitment.taskId);
			if (!task) {
				continue;
			}

			if (event.toState === 'breached') {
				this.publishCommitmentBreached(
					commitment,
					commitment.failureReason ?? this.breachReason,
				).catch((error) => {
					this.log(
						`Failed to publish commitment breach for ${commitment.taskId}: ${error instanceof Error ? error.message : String(error)}`,
					);
				});
				continue;
			}

			const actionByStatus: Partial<
				Record<CommitmentStatus, CommitmentAction>
			> = {
				accepted: 'ACCEPT',
				delivered: 'DELIVER',
				failed: 'FAIL',
			};
			const action = actionByStatus[commitment.status];
			if (!action) {
				continue;
			}

			this.publishCommitmentUpdated(
				{
					taskId: task.taskId,
					turnId: task.turnId,
					requesterConnectionId: task.requesterConnectionId,
				},
				commitment.assigneeId,
				action,
				commitment.status,
			).catch((error) => {
				this.log(
					`Failed to publish commitment update for ${commitment.taskId}: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
		}
	};

	private sendHostAck = async (input: {
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
	}) => {
		const response: IDirectResponsePayload = {
			requestId: input.request.requestId,
			fromAgentId: input.request.toAgentId,
			fromAgentName: input.request.toAgentName,
			toAgentId: input.request.fromAgentId,
			toAgentName: input.request.fromAgentName,
			action: 'ACK',
			origin: 'host',
			ackKind: input.ackKind,
			reasonCode: input.reasonCode,
			reason: input.reason,
		};
		await this.messageGateway.sendToConnection(input.requesterConnectionId, {
			type: DIRECT_RESPONSE,
			channel: `direct:${input.request.requestId}`,
			trace: input.trace,
			payload: response,
		});
	};

	private markWorkerWaitingPeer = (
		context: IConnectionContext,
		request: IDirectRequestPayload,
	) => {
		if (
			context.meta.connectionRole !== 'worker' ||
			context.meta.agentId !== request.fromAgentId
		) {
			return;
		}
		const worker = this.store.getWorker(request.fromAgentId);
		if (!worker || worker.workState.kind === 'offline') {
			return;
		}

		const sourceTaskId =
			request.sourceTaskId ?? getTaskIdFromWorkState(worker.workState);
		if (!sourceTaskId) {
			return;
		}

		try {
			this.transitionWorkerState(request.fromAgentId, {
				kind: 'waiting_peer',
				taskId: sourceTaskId,
				requestId: request.requestId,
				toAgentId: request.toAgentId,
			});
		} catch {
			this.log(
				`Unable to transition ${request.fromAgentId} to waiting_peer(${request.requestId})`,
			);
		}
	};

	private restoreRequesterWorkState = (
		agentId: string,
		requestId: string,
		sourceTaskId?: string,
	) => {
		const worker = this.store.getWorker(agentId);
		if (!worker || worker.workState.kind !== 'waiting_peer') {
			return;
		}
		if (worker.workState.requestId !== requestId) {
			return;
		}

		const focusTaskId = sourceTaskId ?? worker.workState.taskId;
		try {
			this.transitionWorkerState(agentId, {
				kind: 'focused',
				taskId: focusTaskId,
			});
		} catch {
			this.forceWorkerState(agentId, {
				kind: 'focused',
				taskId: focusTaskId,
			});
		}
	};

	private resolveRequesterConnection = (parsed: {
		requestId: string;
		fromAgentId: string;
		toAgentId: string;
	}) => {
		const entry = this.inbox.findByRequestId(
			parsed.fromAgentId,
			parsed.requestId,
		);
		if (entry) {
			const storedPayload = entry.payload as Record<string, unknown>;
			if (typeof storedPayload?.requesterConnectionId === 'string') {
				return storedPayload.requesterConnectionId;
			}
		}

		const senderConnectionId = this.mailbox.resolve(parsed.toAgentId);
		return senderConnectionId;
	};

	private completeWork = (input: {
		agentId: string;
		workKind: 'task' | 'direct';
		workId: string;
		outcome: 'completed' | 'dropped';
	}) => {
		this.dispatchCoordinator.completeWork(input);
	};

	private createTaskAssignPayload = (task: ITaskBoardEntry) => {
		return {
			taskId: task.taskId,
			turnId: task.turnId,
			prompt: task.prompt,
			workingDirectory: task.workingDirectory,
			agentId: task.assigneeId,
			agentName: task.assigneeName,
			parentTaskId: task.parentTaskId,
			dependencies: task.dependencies,
			deliverableSpec: task.deliverableSpec,
			slaDeadline: task.slaDeadline,
			assignmentToken: task.assignmentToken,
		} satisfies ITaskAssignPayload;
	};

	private dispatchNextWorkForWorker = async (agentId: string) => {
		await this.dispatchCoordinator.dispatchNextWorkForWorker(agentId);
	};

	private getConnectionContext = (connectionId: string) => {
		return this.connectionManager.getContext(connectionId);
	};

	private updateConnectionMeta = (
		connectionId: string,
		updates: Partial<IConnectionMeta>,
	) => {
		this.connectionManager.updateConnectionMeta(connectionId, updates);
	};

	private transitionWorkerState = (agentId: string, nextState: WorkState) => {
		const worker = this.store.getWorker(agentId);
		if (!worker) {
			throw new Error(`Worker ${agentId} not found`);
		}

		const previous = worker.workState;
		const result = transitionWork({
			current: previous,
			next: nextState,
			aggregateId: worker.agentId,
			eventContext: {
				actor: worker.agentId,
				actorName: worker.agentName,
				metadata: buildWorkTransitionMetadata(previous, nextState),
			},
		});
		const next = result.state;
		this.store.setWorker({
			...worker,
			workState: next,
			lastSeenAt: Date.now(),
		});
		this.onTransitionEvents(result.domainEvents);
		this.logWorkerTransition(worker.agentId, previous, next);
	};

	private forceWorkerState = (agentId: string, workState: WorkState) => {
		const worker = this.store.getWorker(agentId);
		if (!worker) {
			return;
		}
		const previous = worker.workState;
		this.store.setWorker({
			...worker,
			workState,
			lastSeenAt: Date.now(),
		});
		this.logWorkerTransition(worker.agentId, previous, workState);
	};

	private markWorkerOffline = (agentId: string) => {
		const worker = this.store.getWorker(agentId);
		if (!worker) {
			return;
		}

		if (worker.workState.kind === 'offline') {
			this.store.setWorker({
				...worker,
				lastSeenAt: Date.now(),
			});
			return;
		}

		try {
			this.transitionWorkerState(agentId, { kind: 'offline' });
		} catch {
			this.forceWorkerState(agentId, { kind: 'offline' });
		}
	};

	private hasActiveWorkerReferences = (agentId: string) => {
		return this.getActiveReferenceAgentIds(this.store.snapshot()).has(agentId);
	};

	private getActiveReferenceAgentIds = (
		snapshot: Pick<IStoreSnapshot, 'taskBoard' | 'commitments'>,
	) => {
		const activeAgentIds = new Set<string>();

		for (const task of snapshot.taskBoard) {
			if (
				task.assigneeId &&
				(task.status === 'todo' ||
					task.status === 'assigned' ||
					task.status === 'doing' ||
					task.status === 'blocked')
			) {
				activeAgentIds.add(task.assigneeId);
			}
		}

		for (const commitment of snapshot.commitments) {
			if (commitment.status === 'accepted') {
				activeAgentIds.add(commitment.assigneeId);
			}
		}

		return activeAgentIds;
	};

	private createClaimLeaseReaper = () => {
		return new ClaimLeaseReaper({
			store: this.store,
			onReaped: async (input) => {
				this.log(
					`[claim-reaper] taskId=${input.taskId} agentId=${input.agentId ?? 'unknown'} token=${input.token ?? 'none'}`,
				);
			},
			onExecutionLeaseExpired: this.handleExecutionLeaseExpired,
		});
	};

	private handleExecutionLeaseExpired = async (input: {
		taskId: string;
		agentId: string;
	}) => {
		const at = Date.now();
		const task = this.store.getTaskBoardEntry(input.taskId);
		if (!task) {
			return;
		}
		const worker = this.store.getWorker(input.agentId);
		if (!worker) {
			return;
		}
		const commitment = this.store.getCommitmentByTaskId(input.taskId);
		if (commitment && commitment.status === 'accepted') {
			this.agreementService.applyCommitmentTransition({
				commitment,
				nextStatus: 'breached',
				failureReason: 'execution lease expired',
				at,
				eventContext: {
					actor: input.agentId,
					actorName: worker.agentName,
					metadata: {
						taskId: commitment.taskId,
						assigneeId: commitment.assigneeId,
						delegatedBy: commitment.delegatedBy,
					},
				},
			});
		}

		const claimAttempt = task.claimAttempt ?? 0;
		if (task.status === 'doing' && claimAttempt < maxClaimRetries) {
			this.taskBoardService.markRequeued(input.taskId, at);
			this.log(
				`[execution-lease] taskId=${input.taskId} requeued (attempt ${claimAttempt + 1}/${maxClaimRetries})`,
			);
			return;
		}

		if (task.status !== 'done' && task.status !== 'cancelled') {
			this.taskBoardService.markCancelled(
				input.taskId,
				'execution lease expired',
				at,
			);
		}
		await this.messageGateway.sendToConnection(task.requesterConnectionId, {
			type: TASK_FAILED,
			channel: `task:${task.taskId}`,
			trace: {
				taskId: task.taskId,
				turnId: task.turnId,
			},
			payload: {
				taskId: task.taskId,
				agentId: input.agentId,
				agentName: worker.agentName,
				message: 'execution lease expired',
			} satisfies ITaskFailedPayload,
		});
	};

	private logWorkerTransition = (
		agentId: string,
		fromState: WorkState,
		toState: WorkState,
	) => {
		this.log(
			`Worker ${agentId}: ${formatWorkState(fromState)} -> ${formatWorkState(toState)}`,
		);
	};

	private log = (message: string) => {
		this.options.onLog?.(message);
	};

	private resolveAgentName = (agentId: string) => {
		return this.store.getWorker(agentId)?.agentName ?? agentId;
	};

	private nextTimelineSeq = () => {
		this.timelineSeq += 1;
		return this.timelineSeq;
	};
}
