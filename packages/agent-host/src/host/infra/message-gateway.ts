import {
	createEnvelope,
	type IProtocolEnvelope,
	type IProtocolErrorPayload,
} from '@agent-group-lab/protocol';
import type { IHostPortConnection } from '~/ports/host-server-port';
import type { ILiveConnectionState } from './connection-manager';

interface IMessageGatewayOptions {
	nextSeq: () => number;
	getLiveConnection: (connectionId: string) => ILiveConnectionState | undefined;
}

export interface IMessageGateway {
	createEnvelope: (
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => IProtocolEnvelope<string, unknown>;
	sendToConnection: (
		connectionId: string,
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => Promise<void>;
	sendProtocolError: (
		connection: IHostPortConnection,
		code: IProtocolErrorPayload['code'],
		message: string,
		details?: Record<string, unknown>,
	) => Promise<void>;
	sendErrorPayload: (
		connection: IHostPortConnection,
		error: Error,
	) => Promise<void>;
}

export class MessageGateway implements IMessageGateway {
	private readonly options: IMessageGatewayOptions;

	constructor(options: IMessageGatewayOptions) {
		this.options = options;
	}

	createEnvelope = (
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => {
		return createEnvelope({
			seq: this.options.nextSeq(),
			...message,
		});
	};

	sendToConnection = async (
		connectionId: string,
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => {
		const target = this.options.getLiveConnection(connectionId);
		if (!target) {
			return;
		}

		await target.connection.send(this.createEnvelope(message));
	};

	sendProtocolError = async (
		connection: IHostPortConnection,
		code: IProtocolErrorPayload['code'],
		message: string,
		details?: Record<string, unknown>,
	) => {
		await connection.send(
			this.createEnvelope({
				type: 'control:error',
				channel: 'control',
				payload: {
					code,
					message,
					details,
				} satisfies IProtocolErrorPayload,
			}),
		);
	};

	sendErrorPayload = async (connection: IHostPortConnection, error: Error) => {
		await connection.send(
			this.createEnvelope({
				type: 'control:error',
				channel: 'control',
				payload: {
					code: 'protocol',
					message: error.message,
				} satisfies IProtocolErrorPayload,
			}),
		);
	};
}
