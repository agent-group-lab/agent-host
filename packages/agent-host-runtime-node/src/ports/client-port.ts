import type {
	IProtocolEnvelope,
	IReceivedEnvelope,
} from '@agent-group-lab/protocol';

export interface IClientPort {
	connect: () => Promise<void>;
	send: (message: IProtocolEnvelope<string, unknown>) => Promise<void>;
	subscribe: (listener: (message: IReceivedEnvelope) => void) => () => void;
	waitForMessage: (
		matcher: (message: IReceivedEnvelope) => boolean,
		timeoutMs?: number,
	) => Promise<IReceivedEnvelope>;
	close: () => Promise<void>;
}
