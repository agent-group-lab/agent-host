import type { IProtocolEnvelope } from '@agent-group-lab/protocol';

export interface IHostPortConnection {
	id: string;
	send: (message: IProtocolEnvelope<string, unknown>) => Promise<void>;
	close: () => Promise<void>;
}

export interface IHostServerPort {
	start: () => Promise<void>;
	stop: () => Promise<void>;
	onConnection: (
		handler: (connection: IHostPortConnection) => Promise<void> | void,
	) => void;
	onMessage: (
		handler: (
			connection: IHostPortConnection,
			message: IProtocolEnvelope<string, unknown>,
		) => Promise<void> | void,
	) => void;
	onDisconnect: (
		handler: (
			connection: IHostPortConnection,
			hadError: boolean,
		) => Promise<void> | void,
	) => void;
	onError: (handler: (error: unknown) => Promise<void> | void) => void;
}
