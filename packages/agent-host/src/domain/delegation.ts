import {
	assertMachineTransition,
	canTransitionByMachine,
	createStatusMachine,
	createTransitionEvents,
	type ITransitionEventContext,
	type ITransitionResult,
} from './machine-adapter';

export type DelegationStatus =
	| 'pending'
	| 'accepted'
	| 'completed'
	| 'rejected';

export interface IDelegationRecord {
	delegationId: string;
	delegatorId: string;
	delegateeId: string;
	originalTaskId: string;
	delegatedTaskId: string;
	status: DelegationStatus;
	createdAt: number;
	completedAt?: number;
}

const allowedDelegationTransitions: Record<
	DelegationStatus,
	readonly DelegationStatus[]
> = {
	pending: ['accepted', 'rejected'],
	accepted: ['completed', 'rejected'],
	completed: [],
	rejected: [],
};

const delegationStatuses = [
	'pending',
	'accepted',
	'completed',
	'rejected',
] as const satisfies readonly DelegationStatus[];

const delegationStatusMachine = createStatusMachine(
	'delegation-status-machine',
	delegationStatuses,
	allowedDelegationTransitions,
);

export interface ICreateDelegationRecordInput {
	delegationId: string;
	delegatorId: string;
	delegateeId: string;
	originalTaskId: string;
	delegatedTaskId: string;
}

export const createDelegationRecord = (
	input: ICreateDelegationRecordInput,
	at = Date.now(),
) => {
	return {
		delegationId: input.delegationId,
		delegatorId: input.delegatorId,
		delegateeId: input.delegateeId,
		originalTaskId: input.originalTaskId,
		delegatedTaskId: input.delegatedTaskId,
		status: 'pending',
		createdAt: at,
	} satisfies IDelegationRecord;
};

export const canTransitionDelegationStatus = (
	from: DelegationStatus,
	to: DelegationStatus,
) => {
	return canTransitionByMachine(delegationStatusMachine, from, to);
};

export interface ITransitionDelegationStateInput {
	delegation: IDelegationRecord;
	nextStatus: DelegationStatus;
	at?: number;
}

export interface ITransitionDelegationInput
	extends ITransitionDelegationStateInput {
	eventContext?: Omit<
		Partial<ITransitionEventContext>,
		'aggregateType' | 'aggregateId' | 'fromState' | 'toState' | 'trigger'
	>;
}

export const transitionDelegationState = (
	input: ITransitionDelegationStateInput,
) => {
	assertMachineTransition(
		delegationStatusMachine,
		input.delegation.status,
		input.nextStatus,
		`Invalid delegation transition: ${input.delegation.status} -> ${input.nextStatus}`,
	);
	const next: IDelegationRecord = {
		...input.delegation,
		status: input.nextStatus,
	};
	if (input.nextStatus === 'completed' || input.nextStatus === 'rejected') {
		next.completedAt = input.at ?? Date.now();
	}
	return next;
};

export const transitionDelegation = (
	input: ITransitionDelegationInput,
): ITransitionResult<IDelegationRecord> => {
	const state = transitionDelegationState(input);
	const domainEvents = createTransitionEvents({
		aggregateType: 'delegation',
		aggregateId: state.delegationId,
		fromState: input.delegation.status,
		toState: input.nextStatus,
		trigger: input.nextStatus,
		occurredAt: input.at,
		actor: input.eventContext?.actor,
		actorName: input.eventContext?.actorName,
		correlationId: input.eventContext?.correlationId,
		causationId: input.eventContext?.causationId,
		metadata: input.eventContext?.metadata,
	});

	return {
		changed: input.delegation.status !== input.nextStatus,
		state,
		domainEvents,
	};
};
