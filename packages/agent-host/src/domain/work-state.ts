import type { WorkState, WorkStateKind } from '@agent-group-lab/contracts/work';

import {
	assertMachineTransition,
	canTransitionByMachine,
	createStatusMachine,
	createTransitionEvents,
	type ITransitionEventContext,
	type ITransitionResult,
} from './machine-adapter';

export type { WorkState, WorkStateKind };

const allowedWorkTransitions: Record<WorkStateKind, readonly WorkStateKind[]> =
	{
		offline: ['idle'],
		idle: ['focused', 'offline'],
		focused: [
			'waiting_tool',
			'waiting_delegation',
			'waiting_peer',
			'blocked',
			'finished',
			'offline',
		],
		waiting_tool: [
			'focused',
			'waiting_delegation',
			'waiting_peer',
			'blocked',
			'finished',
			'offline',
		],
		waiting_delegation: [
			'focused',
			'waiting_peer',
			'blocked',
			'finished',
			'offline',
		],
		waiting_peer: ['focused', 'blocked', 'finished', 'offline'],
		blocked: ['focused', 'finished', 'offline'],
		finished: ['idle'],
	};

const workStatuses = [
	'offline',
	'idle',
	'focused',
	'waiting_tool',
	'waiting_delegation',
	'waiting_peer',
	'blocked',
	'finished',
] as const satisfies readonly WorkStateKind[];

const workStateMachine = createStatusMachine(
	'work-state-machine',
	workStatuses,
	allowedWorkTransitions,
);

export const canTransitionWork = (from: WorkStateKind, to: WorkStateKind) => {
	return canTransitionByMachine(workStateMachine, from, to);
};

export const transitionWorkState = (current: WorkState, next: WorkState) => {
	assertMachineTransition(
		workStateMachine,
		current.kind,
		next.kind,
		`Invalid work state transition: ${current.kind} -> ${next.kind}`,
	);
	return next;
};

export interface ITransitionWorkInput {
	current: WorkState;
	next: WorkState;
	aggregateId: string;
	occurredAt?: number;
	eventContext?: Omit<
		Partial<ITransitionEventContext>,
		'aggregateType' | 'aggregateId' | 'fromState' | 'toState' | 'trigger'
	>;
}

export const transitionWork = (
	input: ITransitionWorkInput,
): ITransitionResult<WorkState> => {
	const state = transitionWorkState(input.current, input.next);
	const domainEvents = createTransitionEvents({
		aggregateType: 'work',
		aggregateId: input.aggregateId,
		fromState: input.current.kind,
		toState: input.next.kind,
		trigger: input.next.kind,
		occurredAt: input.occurredAt,
		actor: input.eventContext?.actor,
		actorName: input.eventContext?.actorName,
		correlationId: input.eventContext?.correlationId,
		causationId: input.eventContext?.causationId,
		metadata: input.eventContext?.metadata,
	});

	return {
		changed: input.current.kind !== input.next.kind,
		state,
		domainEvents,
	};
};

export const createInitialWorkState = (
	kind: 'offline' | 'idle' = 'offline',
): WorkState => {
	return { kind };
};

export const getTaskIdFromWorkState = (workState: WorkState) => {
	switch (workState.kind) {
		case 'focused':
		case 'waiting_tool':
		case 'waiting_delegation':
		case 'waiting_peer':
		case 'blocked':
		case 'finished':
			return workState.taskId;
		case 'offline':
		case 'idle':
			return undefined;
	}
};

export const formatWorkState = (workState: WorkState) => {
	switch (workState.kind) {
		case 'focused':
			return `${workState.kind}(${workState.taskId})`;
		case 'waiting_tool':
		case 'waiting_delegation':
			return workState.toolName
				? `${workState.kind}(${workState.taskId},${workState.toolName})`
				: `${workState.kind}(${workState.taskId})`;
		case 'waiting_peer':
			return `${workState.kind}(${workState.taskId},${workState.requestId},${workState.toAgentId})`;
		case 'blocked':
			return `${workState.kind}(${workState.taskId},${workState.reason})`;
		case 'finished':
			return `${workState.kind}(${workState.taskId})`;
		case 'offline':
		case 'idle':
			return workState.kind;
	}
};
