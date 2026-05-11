import {
	assertMachineTransition,
	canTransitionByMachine,
	createStatusMachine,
	createTransitionEvents,
	type ITransitionEventContext,
	type ITransitionResult,
} from './machine-adapter';

export type CommitmentStatus =
	| 'none'
	| 'accepted'
	| 'delivered'
	| 'failed'
	| 'breached';

export interface ICommitmentRecord {
	commitmentId: string;
	taskId: string;
	assigneeId: string;
	assigneeName: string | undefined;
	delegatedBy?: string;
	status: CommitmentStatus;
	deliverableSpec?: string;
	slaDeadline?: number;
	artifact?: unknown;
	failureReason?: string;
	progress?: string;
	deliveredRequestId?: string;
	createdAt: number;
	acceptedAt?: number;
	resolvedAt?: number;
}

const terminalStatuses = new Set<CommitmentStatus>([
	'delivered',
	'failed',
	'breached',
]);

const allowedCommitmentTransitions: Record<
	CommitmentStatus,
	readonly CommitmentStatus[]
> = {
	none: ['accepted'],
	accepted: ['delivered', 'failed', 'breached'],
	delivered: [],
	failed: [],
	breached: [],
};

const commitmentStatuses = [
	'none',
	'accepted',
	'delivered',
	'failed',
	'breached',
] as const satisfies readonly CommitmentStatus[];

const commitmentStatusMachine = createStatusMachine(
	'commitment-status-machine',
	commitmentStatuses,
	allowedCommitmentTransitions,
);

export interface ICreateCommitmentRecordInput {
	commitmentId: string;
	taskId: string;
	assigneeId: string;
	assigneeName?: string;
	delegatedBy?: string;
	deliverableSpec?: string;
	slaDeadline?: number;
}

export const createCommitmentRecord = (
	input: ICreateCommitmentRecordInput,
	at = Date.now(),
): ICommitmentRecord => {
	return {
		commitmentId: input.commitmentId,
		taskId: input.taskId,
		assigneeId: input.assigneeId,
		assigneeName: input.assigneeName,
		delegatedBy: input.delegatedBy,
		status: 'none',
		deliverableSpec: input.deliverableSpec,
		slaDeadline: input.slaDeadline,
		createdAt: at,
	};
};

export const isCommitmentTerminal = (status: CommitmentStatus) => {
	return terminalStatuses.has(status);
};

export const canTransitionCommitmentStatus = (
	from: CommitmentStatus,
	to: CommitmentStatus,
) => {
	return canTransitionByMachine(commitmentStatusMachine, from, to);
};

export interface ITransitionCommitmentStateInput {
	commitment: ICommitmentRecord;
	nextStatus: CommitmentStatus;
	at?: number;
	artifact?: unknown;
	failureReason?: string;
	deliveredRequestId?: string;
}

export interface ITransitionCommitmentInput
	extends ITransitionCommitmentStateInput {
	eventContext?: Omit<
		Partial<ITransitionEventContext>,
		'aggregateType' | 'aggregateId' | 'fromState' | 'toState' | 'trigger'
	>;
}

export const transitionCommitmentState = (
	input: ITransitionCommitmentStateInput,
) => {
	assertMachineTransition(
		commitmentStatusMachine,
		input.commitment.status,
		input.nextStatus,
		`Invalid commitment transition: ${input.commitment.status} -> ${input.nextStatus}`,
	);

	const transitionAt = input.at ?? Date.now();
	const nextCommitment: ICommitmentRecord = {
		...input.commitment,
		status: input.nextStatus,
	};

	if (input.nextStatus === 'accepted') {
		nextCommitment.acceptedAt = transitionAt;
		nextCommitment.resolvedAt = undefined;
		nextCommitment.artifact = undefined;
		nextCommitment.failureReason = undefined;
		nextCommitment.deliveredRequestId = undefined;
		return nextCommitment;
	}

	nextCommitment.resolvedAt = transitionAt;
	nextCommitment.progress = undefined;
	if (input.nextStatus === 'delivered') {
		nextCommitment.artifact = input.artifact;
		nextCommitment.failureReason = undefined;
		nextCommitment.deliveredRequestId = input.deliveredRequestId;
		return nextCommitment;
	}

	nextCommitment.failureReason = input.failureReason;
	nextCommitment.artifact = undefined;
	nextCommitment.deliveredRequestId = undefined;
	return nextCommitment;
};

export const transitionCommitment = (
	input: ITransitionCommitmentInput,
): ITransitionResult<ICommitmentRecord> => {
	const state = transitionCommitmentState(input);
	const domainEvents = createTransitionEvents({
		aggregateType: 'commitment',
		aggregateId: state.commitmentId,
		fromState: input.commitment.status,
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
		changed: input.commitment.status !== input.nextStatus,
		state,
		domainEvents,
	};
};

export interface IUpdateCommitmentProgressInput {
	commitment: ICommitmentRecord;
	progress: string;
}

export const updateCommitmentProgress = (
	input: IUpdateCommitmentProgressInput,
) => {
	return {
		...input.commitment,
		progress: input.progress,
	};
};
