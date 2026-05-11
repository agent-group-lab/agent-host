import type { IProtocolEnvelope } from '@agent-group-lab/protocol';

type IReceivedEnvelope = IProtocolEnvelope<string, Record<string, unknown>>;

export interface IWorkerClientPort {
	connect: () => Promise<void>;
	send: (message: IProtocolEnvelope<string, unknown>) => Promise<void>;
	subscribe: (listener: (message: IReceivedEnvelope) => void) => () => void;
	onDisconnect: (listener: () => void) => () => void;
	waitForMessage: (
		matcher: (message: IReceivedEnvelope) => boolean,
		timeoutMs?: number,
	) => Promise<IReceivedEnvelope>;
	close: () => Promise<void>;
}
