import {
	decodeEnvelopeFrames,
	encodeEnvelopeFrame,
	type IProtocolEnvelope,
	type IReceivedEnvelope,
} from '@agent-group-lab/protocol';
import type { IClientPort } from '~/ports/client-port';
import { MessageWaiters } from '~/transport/shared/message-waiters';

export interface IWebSocketClientOptions {
	wsUrl: string;
}

const dataToText = async (data: unknown) => {
	if (typeof data === 'string') {
		return data;
	}
	if (data instanceof ArrayBuffer) {
		return new TextDecoder().decode(data);
	}
	if (ArrayBuffer.isView(data)) {
		return new TextDecoder().decode(data);
	}
	if (data instanceof Blob) {
		return await data.text();
	}
	throw new Error(`Unsupported websocket message type: ${typeof data}`);
};

export class WebSocketClient implements IClientPort {
	private readonly options: IWebSocketClientOptions;
	private socket: WebSocket | null = null;
	private connectPromise: Promise<void> | null = null;
	private buffer = '';
	private readonly listeners = new Set<(message: IReceivedEnvelope) => void>();
	private readonly disconnectListeners = new Set<() => void>();
	private readonly waiters = new MessageWaiters();

	constructor(options: IWebSocketClientOptions) {
		this.options = options;
	}

	connect = async () => {
		if (this.socket && this.socket.readyState === WebSocket.OPEN) {
			return;
		}
		if (this.connectPromise) {
			await this.connectPromise;
			return;
		}

		const socket = new WebSocket(this.options.wsUrl);
		this.socket = socket;

		this.connectPromise = new Promise<void>((resolve, reject) => {
			const handleOpen = () => {
				cleanup();
				this.connectPromise = null;
				resolve();
			};
			const handleError = () => {
				cleanup();
				this.connectPromise = null;
				reject(new Error('WebSocket connection failed'));
			};
			const cleanup = () => {
				socket.removeEventListener('open', handleOpen);
				socket.removeEventListener('error', handleError);
			};

			socket.addEventListener('open', handleOpen);
			socket.addEventListener('error', handleError);
		});

		socket.addEventListener('message', (event) => {
			this.handleSocketData(event.data).catch((error) => {
				this.waiters.rejectAll(error as Error);
			});
		});
		socket.addEventListener('close', () => {
			this.waiters.rejectAll(new Error('WebSocket closed'));
			this.connectPromise = null;
			this.socket = null;
			for (const listener of this.disconnectListeners) {
				listener();
			}
		});
		socket.addEventListener('error', () => {
			this.waiters.rejectAll(new Error('WebSocket error'));
		});

		await this.connectPromise;
	};

	send = async (message: IProtocolEnvelope<string, unknown>) => {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
			throw new Error('WebSocket is not connected');
		}
		this.socket.send(encodeEnvelopeFrame(message));
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
		this.waiters.rejectAll(new Error('WebSocket closed'));
		this.socket = null;
		this.connectPromise = null;
		await new Promise<void>((resolve) => {
			if (
				socket.readyState === WebSocket.CLOSING ||
				socket.readyState === WebSocket.CLOSED
			) {
				resolve();
				return;
			}
			const onClose = () => {
				socket.removeEventListener('close', onClose);
				resolve();
			};
			socket.addEventListener('close', onClose);
			socket.close();
		});
	};

	private handleSocketData = async (data: unknown) => {
		const chunk = await dataToText(data);
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
