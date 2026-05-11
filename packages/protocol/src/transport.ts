import type { IControlLifecycleEvent } from './state-machine';
import type { IProtocolEnvelope } from './types';

export type TransportConnectionState =
	| 'disconnected'
	| 'connecting'
	| 'connected'
	| 'reconnecting'
	| 'closed';

export interface ITransportReconnectPolicy {
	enabled: boolean;
	maxAttempts: number;
	baseDelayMs: number;
	maxDelayMs: number;
}

export interface ITransportLifecycleContext {
	state: TransportConnectionState;
	attempt?: number;
	reason?: string;
}

export type TransportMessageHandler<TMessage = IProtocolEnvelope> = (
	message: TMessage,
) => void | Promise<void>;

export type TransportLifecycleHandler = (
	event: IControlLifecycleEvent,
	context: ITransportLifecycleContext,
) => void | Promise<void>;

export interface ITransport<TMessage = IProtocolEnvelope> {
	readonly id: string;
	readonly state: TransportConnectionState;
	connect: () => Promise<void>;
	send: (message: TMessage) => Promise<void>;
	subscribe: (handler: TransportMessageHandler<TMessage>) => () => void;
	onLifecycleEvent: (handler: TransportLifecycleHandler) => () => void;
	close: (reason?: string) => Promise<void>;
}
