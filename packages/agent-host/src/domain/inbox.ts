import { canTransitionByMachine, createStatusMachine } from './machine-adapter';

export type InboxEntryStatus =
	| 'queued'
	| 'reserved'
	| 'dispatched'
	| 'completed'
	| 'dropped';

export interface IDirectInboxWorkRef {
	workKind: 'direct';
	workId: string;
	targetAgentId: string;
	sourceAgentId: string;
	priority: number;
	deadline?: number;
	payloadRef: {
		requestId: string;
		sourceTaskId?: string;
	};
}

export interface ITaskInboxWorkRef {
	workKind: 'task';
	workId: string;
	targetAgentId: string;
	sourceAgentId: string;
	priority: number;
	deadline?: number;
	payloadRef: {
		taskId: string;
	};
}

export type IInboxWorkRef = IDirectInboxWorkRef | ITaskInboxWorkRef;
export type InboxWorkKind = IInboxWorkRef['workKind'];

const allowedInboxTransitions: Record<
	InboxEntryStatus,
	readonly InboxEntryStatus[]
> = {
	queued: ['reserved', 'dropped'],
	reserved: ['queued', 'dispatched', 'dropped'],
	dispatched: ['completed', 'dropped'],
	completed: [],
	dropped: [],
};

const inboxStatuses = [
	'queued',
	'reserved',
	'dispatched',
	'completed',
	'dropped',
] as const satisfies readonly InboxEntryStatus[];

const inboxStatusMachine = createStatusMachine(
	'inbox-status-machine',
	inboxStatuses,
	allowedInboxTransitions,
);

export interface IInboxEntry {
	entryId: string;
	toAgentId: string;
	toAgentName?: string;
	fromAgentId: string;
	fromAgentName?: string;
	requestId: string;
	status: InboxEntryStatus;
	work: IInboxWorkRef;
	payload: Record<string, unknown>;
	createdAt: number;
	updatedAt: number;
}

export interface IInboxAddInput {
	entryId: string;
	toAgentId: string;
	toAgentName?: string;
	fromAgentId: string;
	fromAgentName?: string;
	requestId: string;
	work?: IInboxWorkRef;
	payload: Record<string, unknown>;
}

export interface IInboxTransitionMetadata {
	reason?: string;
}

export const canTransitionInbox = (
	from: InboxEntryStatus,
	to: InboxEntryStatus,
) => {
	return canTransitionByMachine(inboxStatusMachine, from, to);
};

export const createDirectInboxWorkRef = (input: {
	toAgentId: string;
	fromAgentId: string;
	requestId: string;
	priority?: number;
	deadline?: number;
	sourceTaskId?: string;
}) => {
	return {
		workId: input.requestId,
		workKind: 'direct',
		targetAgentId: input.toAgentId,
		sourceAgentId: input.fromAgentId,
		priority: input.priority ?? 0,
		deadline: input.deadline,
		payloadRef: {
			requestId: input.requestId,
			sourceTaskId: input.sourceTaskId,
		},
	} satisfies IDirectInboxWorkRef;
};

export const createTaskInboxWorkRef = (input: {
	taskId: string;
	targetAgentId: string;
	sourceAgentId: string;
	priority?: number;
	deadline?: number;
}) => {
	return {
		workId: input.taskId,
		workKind: 'task',
		targetAgentId: input.targetAgentId,
		sourceAgentId: input.sourceAgentId,
		priority: input.priority ?? 0,
		deadline: input.deadline,
		payloadRef: {
			taskId: input.taskId,
		},
	} satisfies ITaskInboxWorkRef;
};
