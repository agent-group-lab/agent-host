import { createConnection, type Socket } from 'node:net';
import {
	decodeEnvelopeFrames,
	encodeEnvelopeFrame,
	type IProtocolEnvelope,
	type IReceivedEnvelope,
} from '@agent-group-lab/protocol';
import type { IClientPort } from '~/ports/client-port';
import { MessageWaiters } from '~/transport/shared/message-waiters';

export interface IUdsClientOptions {
	socketPath: string;
}

export class UdsClient implements IClientPort {
	private readonly options: IUdsClientOptions;
	private socket: Socket | null = null;
	private buffer = '';
	private readonly listeners = new Set<(message: IReceivedEnvelope) => void>();
	private readonly disconnectListeners = new Set<() => void>();
	private readonly waiters = new MessageWaiters();

	constructor(options: IUdsClientOptions) {
		this.options = options;
	}

	connect = async () => {
		if (this.socket) {
			return;
		}

		this.socket = createConnection(this.options.socketPath);
		await new Promise<void>((resolve, reject) => {
			if (!this.socket) {
				reject(new Error('Socket is not initialized'));
				return;
			}

			const onConnect = () => {
				this.socket?.off('error', onError);
				resolve();
			};
			const onError = (error: Error) => {
				this.socket?.off('connect', onConnect);
				reject(error);
			};

			this.socket.once('connect', onConnect);
			this.socket.once('error', onError);
		});

		this.socket.on('data', (chunk) => {
			this.handleSocketData(chunk.toString()).catch((error) => {
				this.waiters.rejectAll(error as Error);
			});
		});
		this.socket.on('close', () => {
			this.waiters.rejectAll(new Error('Socket closed'));
			this.socket = null;
			for (const listener of this.disconnectListeners) {
				listener();
			}
		});
		this.socket.on('error', (error) => {
			this.waiters.rejectAll(error as Error);
		});
	};

	send = async (message: IProtocolEnvelope<string, unknown>) => {
		if (!this.socket) {
			throw new Error('Socket is not connected');
		}

		await new Promise<void>((resolve, reject) => {
			this.socket?.write(encodeEnvelopeFrame(message), (error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	};

	subscribe = (listener: (message: IReceivedEnvelope) => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	onDisconnect = (listener: () => void) => {
		this.disconnectListeners.add(listener);
		return () => {
			this.disconnectListeners.delete(listener);
		};
	};

	waitForMessage = async (
		matcher: (message: IReceivedEnvelope) => boolean,
		timeoutMs?: number,
	) => {
		return await this.waiters.waitForMessage(matcher, timeoutMs);
	};

	close = async () => {
		if (!this.socket) {
			return;
		}

		const socket = this.socket;
		this.waiters.rejectAll(new Error('Socket closed'));
		this.socket = null;
		await new Promise<void>((resolve) => {
			socket.end(() => {
				resolve();
			});
		});
	};

	private handleSocketData = async (chunk: string) => {
		const decoded = decodeEnvelopeFrames(chunk, this.buffer);
		this.buffer = decoded.rest;
		for (const message of decoded.messages) {
			for (const listener of this.listeners) {
				listener(message);
			}
			this.waiters.resolveMatching(message);
		}
	};
}
