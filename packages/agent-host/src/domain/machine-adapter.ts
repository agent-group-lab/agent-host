import {
	type ITransitionEvent,
	resolveSemanticAlias,
} from '@agent-group-lab/contracts/events';
import { nanoid } from 'nanoid';
import {
	createMachine,
	type EventObject,
	type StateMachine,
	transition,
} from 'xstate';

export interface ITransitionResult<TState> {
	changed: boolean;
	state: TState;
	domainEvents: ITransitionEvent[];
}

export type TransitionAggregateType =
	| 'work'
	| 'task'
	| 'commitment'
	| 'delegation'
	| 'inbox'
	| 'membership';

export interface ITransitionEventContext {
	aggregateType: TransitionAggregateType;
	aggregateId: string;
	fromState: string;
	toState: string;
	trigger: string;
	occurredAt?: number;
	actor?: string;
	actorName?: string;
	correlationId?: string;
	causationId?: string;
	metadata?: Record<string, unknown>;
}

type IStatusMachine = StateMachine<
	Record<string, never>,
	EventObject,
	Record<string, never>,
	never,
	never,
	never,
	never,
	string,
	string,
	unknown,
	unknown,
	EventObject,
	Record<string, never>,
	Record<string, never>
>;

const baseTransitionEventTypeByAggregate: Record<
	TransitionAggregateType,
	ITransitionEvent['eventType']
> = {
	work: 'work:status_changed',
	task: 'task:status_changed',
	commitment: 'commitment:status_changed',
	delegation: 'delegation:status_changed',
	inbox: 'inbox:status_changed',
	membership: 'membership:status_changed',
};

const createStatusEventName = (status: string) => `TO_${status.toUpperCase()}`;

const toStateValueString = (value: unknown): string => {
	if (typeof value === 'string') {
		return value;
	}
	throw new Error(`Unsupported machine state value type: ${typeof value}`);
};

export const createStatusMachine = <TStatus extends string>(
	machineId: string,
	statuses: readonly TStatus[],
	transitions: Record<TStatus, readonly TStatus[]>,
) => {
	const states = Object.fromEntries(
		statuses.map((status) => {
			const on = Object.fromEntries(
				transitions[status].map((target) => [
					createStatusEventName(target),
					{ target },
				]),
			);
			return [status, { on }];
		}),
	);

	return createMachine({
		id: machineId,
		context: {},
		initial: statuses[0],
		states,
	}) as IStatusMachine;
};

export const canTransitionByMachine = <TStatus extends string>(
	machine: IStatusMachine,
	fromState: TStatus,
	toState: TStatus,
) => {
	const fromStateValue = fromState;
	const [nextSnapshot] = transition(
		machine,
		machine.resolveState({ value: fromState, context: {} }),
		{ type: createStatusEventName(toState) },
	);
	const nextStateValue = toStateValueString(nextSnapshot.value);
	return nextStateValue === toState && nextStateValue !== fromStateValue;
};

export const assertMachineTransition = <TStatus extends string>(
	machine: IStatusMachine,
	fromState: TStatus,
	toState: TStatus,
	errorMessage: string,
) => {
	if (!canTransitionByMachine(machine, fromState, toState)) {
		throw new Error(errorMessage);
	}
};

export const createTransitionEvents = (
	context: ITransitionEventContext,
): ITransitionEvent[] => {
	const eventId = nanoid();
	const occurredAt = context.occurredAt ?? Date.now();
	const correlationId = context.correlationId ?? eventId;
	const causationId = context.causationId ?? eventId;
	const baseEventType =
		baseTransitionEventTypeByAggregate[context.aggregateType];

	const baseEvent: ITransitionEvent = {
		schemaVersion: 1,
		eventId,
		eventType: baseEventType,
		aggregateType: context.aggregateType,
		aggregateId: context.aggregateId,
		fromState: context.fromState,
		toState: context.toState,
		trigger: context.trigger,
		occurredAt,
		actor: context.actor ?? 'system',
		actorName: context.actorName,
		correlationId,
		causationId,
		metadata: context.metadata,
	};

	const aliasRule = resolveSemanticAlias(
		baseEvent.eventType,
		context.fromState,
		context.toState,
	);
	if (!aliasRule) {
		return [baseEvent];
	}

	return [
		baseEvent,
		{
			...baseEvent,
			eventType: aliasRule.alias as ITransitionEvent['eventType'],
		},
	];
};
