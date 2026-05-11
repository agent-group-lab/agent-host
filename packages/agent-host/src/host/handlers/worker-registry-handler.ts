import type { ITransitionEvent } from '@agent-group-lab/contracts/events';
import {
	type IWorkerRegisterPayload,
	type IWorkersListPayload,
	type IWorkersListResultPayload,
	WORKERS_LIST_RESULT,
} from '@agent-group-lab/contracts/messages';
import type { WorkState } from '@agent-group-lab/contracts/work';
import { createTransitionEvents } from '~/domain/machine-adapter';
import type { IRoomMember } from '~/domain/membership';
import { createInitialWorkState, transitionWork } from '~/domain/work-state';
import type { IConnectionMeta, IWorkerRegistry } from '~/store/store';
import type { IConnectionContext } from '../infra/connection-manager';
import type { IMessageGateway } from '../infra/message-gateway';

const isSameWorkState = (left: WorkState, right: WorkState) => {
	return JSON.stringify(left) === JSON.stringify(right);
};

interface IWorkerRegistryHandlerOptions {
	store: IWorkerRegistry;
	getMember: (agentId: string) => IRoomMember | undefined;
	setMember: (record: IRoomMember) => void;
	messageGateway: IMessageGateway;
	onTransitionEvents: (events: ITransitionEvent[]) => void;
	updateConnectionMeta: (
		connectionId: string,
		updates: Partial<IConnectionMeta>,
	) => void;
	logWorkerTransition: (
		agentId: string,
		fromState: WorkState,
		toState: WorkState,
	) => void;
	markWorkerOffline: (agentId: string) => void;
	deleteWorker: (agentId: string) => boolean;
	hasActiveWorkerReferences: (agentId: string) => boolean;
	log: (message: string) => void;
}

export class WorkerRegistryHandler {
	private readonly options: IWorkerRegistryHandlerOptions;

	constructor(options: IWorkerRegistryHandlerOptions) {
		this.options = options;
	}

	handleWorkerRegister = async (
		context: IConnectionContext,
		parsed: IWorkerRegisterPayload,
	) => {
		this.options.updateConnectionMeta(context.meta.connectionId, {
			connectionRole: 'worker',
			agentId: parsed.agentId,
		});

		const connectionId =
			parsed.workerType === 'persistent'
				? context.meta.connectionId
				: undefined;
		this.registerWorker({
			agentId: parsed.agentId,
			agentName: parsed.agentName,
			adapterId: parsed.adapterId,
			capabilities: parsed.capabilities,
			agentRole: parsed.role ?? 'executor',
			workerProfile: parsed.workerProfile,
			workerType: parsed.workerType,
			connectionId,
		});
	};

	private registerWorker = (input: {
		agentId: string;
		agentName: string;
		adapterId?: string;
		capabilities: IWorkerRegisterPayload['capabilities'];
		agentRole: NonNullable<IWorkerRegisterPayload['role']>;
		workerProfile: IWorkerRegisterPayload['workerProfile'];
		workerType: IWorkerRegisterPayload['workerType'];
		connectionId?: string;
	}) => {
		const previous = this.options.store.getWorker(input.agentId);
		if (
			input.workerType === 'session' &&
			previous?.workerType === 'persistent'
		) {
			return;
		}
		const previousState =
			previous?.workState ?? createInitialWorkState('offline');
		const idleTarget = createInitialWorkState('idle');
		const transitionResult =
			previousState.kind === 'offline'
				? transitionWork({
						current: previousState,
						next: idleTarget,
						aggregateId: input.agentId,
						eventContext: {
							actor: input.agentId,
							actorName: input.agentName,
						},
					})
				: undefined;
		const idleState = transitionResult?.state ?? idleTarget;
		if (previousState.kind === 'offline') {
			this.options.onTransitionEvents(transitionResult?.domainEvents ?? []);
		}

		this.options.store.setWorker({
			agentId: input.agentId,
			agentName: input.agentName,
			connectionId: input.connectionId,
			adapterId: input.adapterId,
			capabilities: input.capabilities,
			agentRole: input.agentRole,
			workerProfile: input.workerProfile,
			workState: idleState,
			lastSeenAt: Date.now(),
			workerType: input.workerType,
		});
		const existingMember = this.options.getMember(input.agentId);
		this.options.setMember({
			agentId: input.agentId,
			agentName: input.agentName,
			joinedAt: Date.now(),
		});
		if (!existingMember) {
			this.options.onTransitionEvents(
				createTransitionEvents({
					aggregateType: 'membership',
					aggregateId: input.agentId,
					fromState: 'none',
					toState: 'joined',
					trigger: 'worker:register',
					actor: input.agentId,
					actorName: input.agentName,
				}),
			);
		}
		if (!isSameWorkState(previousState, idleState)) {
			this.options.logWorkerTransition(input.agentId, previousState, idleState);
		}
		this.options.log(
			`Worker registered: ${input.agentId} (${input.adapterId ?? 'unknown'})`,
		);
	};

	handleWorkersList = async (
		context: IConnectionContext,
		parsed: IWorkersListPayload,
	) => {
		if (context.meta.connectionRole === 'unknown') {
			this.options.updateConnectionMeta(context.meta.connectionId, {
				connectionRole: 'client',
			});
		}
		const workers = this.options.store
			.listWorkers()
			.filter(
				(worker) =>
					parsed.includeOffline || worker.workState.kind !== 'offline',
			)
			.map((worker) => ({
				agentId: worker.agentId,
				agentName: worker.agentName,
				adapterId: worker.adapterId,
				agentRole: worker.agentRole,
				workerProfile: worker.workerProfile,
				workState: worker.workState,
				lastSeenAt: worker.lastSeenAt,
			}));

		const resultPayload: IWorkersListResultPayload = {
			workers,
		};
		await context.live.connection.send(
			this.options.messageGateway.createEnvelope({
				type: WORKERS_LIST_RESULT,
				channel: 'control',
				payload: resultPayload,
			}),
		);
	};

	reapInactiveSessionWorkers = (input: { now: number; ttlMs: number }) => {
		const justOfflinedAgentIds: string[] = [];
		const sessionWorkers = this.options.store
			.listWorkers()
			.filter((worker) => worker.workerType === 'session');

		for (const worker of sessionWorkers) {
			if (worker.workState.kind !== 'idle') {
				continue;
			}
			if (worker.lastSeenAt > input.now - input.ttlMs) {
				continue;
			}
			this.options.markWorkerOffline(worker.agentId);
			justOfflinedAgentIds.push(worker.agentId);
			this.options.log(
				`[session-presence] worker ${worker.agentId} marked offline after idle TTL`,
			);
		}

		return justOfflinedAgentIds;
	};

	reapInactiveOfflineWorkers = (input: {
		now: number;
		ttlMs: number;
		excludeAgentIds?: string[];
	}) => {
		const excluded = new Set(input.excludeAgentIds ?? []);
		const deletedAgentIds: string[] = [];
		const sessionWorkers = this.options.store
			.listWorkers()
			.filter((worker) => worker.workerType === 'session');

		for (const worker of sessionWorkers) {
			if (excluded.has(worker.agentId)) {
				continue;
			}
			if (worker.workState.kind !== 'offline') {
				continue;
			}
			if (this.options.hasActiveWorkerReferences(worker.agentId)) {
				continue;
			}
			if (worker.lastSeenAt > input.now - input.ttlMs) {
				continue;
			}
			if (!this.options.deleteWorker(worker.agentId)) {
				continue;
			}
			deletedAgentIds.push(worker.agentId);
			this.options.log(
				`[session-presence] worker ${worker.agentId} deleted after offline retention TTL`,
			);
		}

		return deletedAgentIds;
	};
}
