import {
	createProtocolViolationError,
	isProtocolError,
	toProtocolErrorPayload,
} from './errors';
import type { ControlMessageType } from './types';

export type ControlConnectionState =
	| 'init'
	| 'hello'
	| 'ready'
	| 'active'
	| 'closed';

export type ControlLifecycleEventType =
	| 'hello'
	| 'ready'
	| 'heartbeat'
	| 'reconnect'
	| 'closed';

export interface IControlLifecycleEvent {
	type: ControlLifecycleEventType;
	state: ControlConnectionState;
	at: number;
	reason?: string;
}

export interface IControlStateTransition {
	from: ControlConnectionState;
	to: ControlConnectionState;
	messageType: ControlMessageType;
	lifecycleEvent?: IControlLifecycleEvent;
}

const controlErrorType = 'control:error';
const controlDisconnectType = 'control:disconnect';

type NonProgressControlMessageType = Exclude<
	ControlMessageType,
	typeof controlErrorType | typeof controlDisconnectType
>;

const allowedMessageTypesByState: Record<
	ControlConnectionState,
	readonly ControlMessageType[]
> = {
	init: ['control:hello', 'control:error'],
	hello: ['control:ready', 'control:error', 'control:disconnect'],
	ready: [
		'control:heartbeat',
		'control:ack',
		'control:events-since',
		'control:events-since:result',
		'control:error',
		'control:disconnect',
	],
	active: [
		'control:heartbeat',
		'control:ack',
		'control:events-since',
		'control:events-since:result',
		'control:error',
		'control:disconnect',
	],
	closed: [],
};

const resolveNextState = (
	state: Exclude<ControlConnectionState, 'closed'>,
): Exclude<ControlConnectionState, 'closed'> => {
	switch (state) {
		case 'init':
			return 'hello';

		case 'hello':
			return 'ready';

		case 'ready':
			return 'active';

		case 'active':
			return 'active';
	}
};

const resolveLifecycleEvent = (
	type: NonProgressControlMessageType,
	state: Exclude<ControlConnectionState, 'closed'>,
	at: number,
): IControlLifecycleEvent | undefined => {
	switch (type) {
		case 'control:hello':
			return { type: 'hello', state, at };

		case 'control:ready':
			return { type: 'ready', state, at };

		case 'control:heartbeat':
			return { type: 'heartbeat', state, at };

		default:
			return undefined;
	}
};

export class ControlStateMachine {
	private state: ControlConnectionState;

	constructor(initialState: ControlConnectionState = 'init') {
		this.state = initialState;
	}

	getState = () => {
		return this.state;
	};

	canAccept = (messageType: ControlMessageType) => {
		return allowedMessageTypesByState[this.state].includes(messageType);
	};

	expectCanAccept = (messageType: ControlMessageType) => {
		if (!this.canAccept(messageType)) {
			throw createProtocolViolationError(
				`Invalid control message transition: ${this.state} -> ${messageType}`,
				{
					state: this.state,
					messageType,
					expectedMessageTypes: allowedMessageTypesByState[this.state],
				},
			);
		}
	};

	apply = (
		messageType: ControlMessageType,
		at = Date.now(),
	): IControlStateTransition => {
		this.expectCanAccept(messageType);

		const from = this.state;

		if (messageType === 'control:error') {
			return {
				from,
				to: this.state,
				messageType,
			};
		}

		if (messageType === 'control:disconnect') {
			this.state = 'closed';
			return {
				from,
				to: 'closed',
				messageType,
				lifecycleEvent: { type: 'closed', state: 'closed', at },
			};
		}

		if (from === 'closed') {
			throw createProtocolViolationError(
				'Cannot apply control message after connection is closed',
				{
					state: from,
					messageType,
				},
			);
		}

		const to = resolveNextState(from);
		this.state = to;

		return {
			from,
			to,
			messageType,
			lifecycleEvent: resolveLifecycleEvent(messageType, to, at),
		};
	};

	markReconnect = (reason?: string, at = Date.now()) => {
		this.state = 'init';
		return {
			type: 'reconnect',
			state: this.state,
			at,
			reason,
		} as const satisfies IControlLifecycleEvent;
	};

	close = (reason?: string, at = Date.now()) => {
		this.state = 'closed';
		return {
			type: 'closed',
			state: this.state,
			at,
			reason,
		} as const satisfies IControlLifecycleEvent;
	};
}

export const validateControlSequence = (messageTypes: ControlMessageType[]) => {
	const machine = new ControlStateMachine();
	for (const type of messageTypes) {
		machine.apply(type);
	}
	return machine.getState();
};

export const validateControlSequenceSafely = (
	messageTypes: ControlMessageType[],
) => {
	try {
		const state = validateControlSequence(messageTypes);
		return {
			success: true,
			state,
		} as const;
	} catch (error) {
		if (isProtocolError(error)) {
			return {
				success: false,
				error,
				payload: toProtocolErrorPayload(error),
			} as const;
		}

		return {
			success: false,
			error,
			payload: toProtocolErrorPayload(error),
		} as const;
	}
};
