import type { ITransitionEvent } from '@agent-group-lab/contracts/events';
import type {
	IHostWorkerRecord,
	IMemberJoinPayload,
	IMemberJoinResultPayload,
	IMemberLeavePayload,
	IMemberLeaveResultPayload,
	IMemberListPayload,
	IMemberListResultPayload,
} from '@agent-group-lab/contracts/messages';
import {
	MEMBER_JOIN_RESULT,
	MEMBER_LEAVE_RESULT,
	MEMBER_LIST_RESULT,
} from '@agent-group-lab/contracts/messages';
import {
	createTransitionEvents,
	type TransitionAggregateType,
} from '~/domain/machine-adapter';
import type { IHostStore } from '~/store/store';
import type { IConnectionContext } from '../infra/connection-manager';
import type { IMessageGateway } from '../infra/message-gateway';

interface IMembershipHandlerOptions {
	store: IHostStore;
	messageGateway: IMessageGateway;
	onTransitionEvents: (events: ITransitionEvent[]) => void;
	log: (message: string) => void;
}

const getMemberOnlineState = (worker: IHostWorkerRecord | undefined) => {
	return worker !== undefined && worker.workState.kind !== 'offline';
};

export class MembershipHandler {
	private readonly options: IMembershipHandlerOptions;

	constructor(options: IMembershipHandlerOptions) {
		this.options = options;
	}

	handleMemberJoin = async (
		context: IConnectionContext,
		payload: IMemberJoinPayload,
	) => {
		const existing = this.options.store.getMember(payload.agentId);
		this.options.store.setMember({
			agentId: payload.agentId,
			agentName: payload.agentName,
			joinedAt: Date.now(),
		});
		const member = this.options.store.getMember(payload.agentId);
		if (!member) {
			throw new Error(`Member missing after join upsert: ${payload.agentId}`);
		}

		if (!existing) {
			this.emitMembershipTransition({
				aggregateId: payload.agentId,
				fromState: 'none',
				toState: 'joined',
				trigger: 'member:join',
				actor: payload.agentId,
				actorName: payload.agentName,
			});
		}

		const result: IMemberJoinResultPayload = {
			agentId: member.agentId,
			agentName: member.agentName,
			joinedAt: member.joinedAt,
		};
		await this.options.messageGateway.sendToConnection(
			context.meta.connectionId,
			{
				type: MEMBER_JOIN_RESULT,
				channel: 'control',
				payload: result,
			},
		);
	};

	handleMemberLeave = async (
		context: IConnectionContext,
		payload: IMemberLeavePayload,
	) => {
		const existing = this.options.store.getMember(payload.agentId);
		const removed = this.options.store.deleteMember(payload.agentId);

		if (removed) {
			this.emitMembershipTransition({
				aggregateId: payload.agentId,
				fromState: 'joined',
				toState: 'none',
				trigger: 'member:leave',
				actor: payload.agentId,
				actorName: existing?.agentName,
			});
		}

		const result: IMemberLeaveResultPayload = {
			agentId: payload.agentId,
			removed,
		};
		await this.options.messageGateway.sendToConnection(
			context.meta.connectionId,
			{
				type: MEMBER_LEAVE_RESULT,
				channel: 'control',
				payload: result,
			},
		);
	};

	handleMemberList = async (
		context: IConnectionContext,
		_payload: IMemberListPayload,
	) => {
		const members = this.options.store.listMembers();
		const result: IMemberListResultPayload = {
			members: members.map((member) => {
				const worker = this.options.store.getWorker(member.agentId);
				return {
					agentId: member.agentId,
					agentName: member.agentName,
					joinedAt: member.joinedAt,
					online: getMemberOnlineState(worker),
					workState: worker?.workState ?? null,
				};
			}),
		};
		await this.options.messageGateway.sendToConnection(
			context.meta.connectionId,
			{
				type: MEMBER_LIST_RESULT,
				channel: 'control',
				payload: result,
			},
		);
	};

	deleteMembers = (input: { workerIds?: string[] }) => {
		const included = new Set(input.workerIds ?? []);
		for (const workerId of included) {
			const existing = this.options.store.getMember(workerId);
			if (!existing) {
				continue;
			}
			const removed = this.options.store.deleteMember(workerId);
			if (!removed) {
				continue;
			}
			this.emitMembershipTransition({
				aggregateId: workerId,
				fromState: 'joined',
				toState: 'none',
				trigger: 'maintenance:session_inactive_leave',
				actor: workerId,
				actorName: existing.agentName,
			});
			this.options.log(
				`[session-presence] member ${workerId} left room after offline retention TTL`,
			);
		}
	};

	deleteMembersWithoutWorkers = (input: { workerIds: string[] }) => {
		const workerIds = new Set(input.workerIds);
		for (const member of this.options.store.listMembers()) {
			if (workerIds.has(member.agentId)) {
				continue;
			}
			const removed = this.options.store.deleteMember(member.agentId);
			if (!removed) {
				continue;
			}
			this.emitMembershipTransition({
				aggregateId: member.agentId,
				fromState: 'joined',
				toState: 'none',
				trigger: 'maintenance:orphan_member_gc',
				actor: member.agentId,
				actorName: member.agentName,
			});
			this.options.log(
				`[session-presence] member ${member.agentId} left room because worker record is missing`,
			);
		}
	};

	private emitMembershipTransition = (input: {
		aggregateId: string;
		fromState: string;
		toState: string;
		trigger: string;
		actor: string;
		actorName?: string;
	}) => {
		const events = createTransitionEvents({
			aggregateType: 'membership' satisfies TransitionAggregateType,
			aggregateId: input.aggregateId,
			fromState: input.fromState,
			toState: input.toState,
			trigger: input.trigger,
			actor: input.actor,
			actorName: input.actorName,
		});
		this.options.onTransitionEvents(events);
	};
}
