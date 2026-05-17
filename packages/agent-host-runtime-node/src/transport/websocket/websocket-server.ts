import { Buffer } from 'node:buffer';
import type { AddressInfo } from 'node:net';
import {
	decodeEnvelopeFrames,
	encodeEnvelopeFrame,
	type IProtocolEnvelope,
} from '@agent-group-lab/protocol';
import { nanoid } from 'nanoid';
import {
	type RawData,
	type ServerOptions,
	WebSocket,
	WebSocketServer,
} from 'ws';

interface IWebSocketHostConnection {
	id: string;
	send: (message: IProtocolEnvelope<string, unknown>) => Promise<void>;
	close: () => Promise<void>;
}

interface IConnectionInternal {
	connection: IWebSocketHostConnection;
	buffer: string;
}

const noopConnectionHandler = (_connection: IWebSocketHostConnection) => {};
const noopMessageHandler = (
	_connection: IWebSocketHostConnection,
	_message: IProtocolEnvelope<string, unknown>,
) => {};
const noopDisconnectHandler = (
	_connection: IWebSocketHostConnection,
	_hadError: boolean,
) => {};
const noopErrorHandler = (_error: unknown) => {};

export interface IWebSocketHostServerOptions {
	port: number;
	host?: string;
	path?: string;
}

const dataToText = (data: RawData) => {
	if (typeof data === 'string') {
		return data;
	}
	if (Array.isArray(data)) {
		return Buffer.concat(data).toString('utf8');
	}
	return new TextDecoder().decode(data);
};

export class WebSocketHostServer {
	private readonly options: IWebSocketHostServerOptions;
	private readonly connections = new Map<string, IConnectionInternal>();
	private server: WebSocketServer | null = null;
	private connectionHandler: (
		connection: IWebSocketHostConnection,
	) => Promise<void> | void = noopConnectionHandler;
	private messageHandler: (
		connection: IWebSocketHostConnection,
		message: IProtocolEnvelope<string, unknown>,
	) => Promise<void> | void = noopMessageHandler;
	private disconnectHandler: (
		connection: IWebSocketHostConnection,
		hadError: boolean,
	) => Promise<void> | void = noopDisconnectHandler;
	private errorHandler: (error: unknown) => Promise<void> | void =
		noopErrorHandler;

	constructor(options: IWebSocketHostServerOptions) {
		this.options = options;
	}

	start = async () => {
		if (this.server) {
			return;
		}

		const serverOptions: ServerOptions = {
			host: this.options.host,
			path: this.options.path,
			port: this.options.port,
		};
		const server = new WebSocketServer(serverOptions);
		this.server = server;

		server.on('connection', (socket) => {
			this.handleSocketConnected(socket).catch((error) => {
				Promise.resolve(this.errorHandler(error)).catch(() => {});
			});
		});

		await new Promise<void>((resolve, reject) => {
			const onError = (error: Error) => {
				cleanup();
				this.server = null;
				reject(error);
			};
			const onListening = () => {
				cleanup();
				resolve();
			};
			const cleanup = () => {
				server.off('error', onError);
				server.off('listening', onListening);
			};

			server.once('error', onError);
			server.once('listening', onListening);
		});
	};

	stop = async () => {
		if (!this.server) {
			return;
		}

		const activeConnections = [...this.connections.values()];
		for (const conn of activeConnections) {
			await conn.connection.close();
		}

		const currentServer = this.server;
		this.server = null;
		await new Promise<void>((resolve, reject) => {
			currentServer.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	};

	address = (): AddressInfo | string | null => {
		return this.server?.address() ?? null;
	};

	onConnection = (
		handler: (connection: IWebSocketHostConnection) => Promise<void> | void,
	) => {
		this.connectionHandler = handler;
	};

	onMessage = (
		handler: (
			connection: IWebSocketHostConnection,
			message: IProtocolEnvelope<string, unknown>,
		) => Promise<void> | void,
	) => {
		this.messageHandler = handler;
	};

	onDisconnect = (
		handler: (
			connection: IWebSocketHostConnection,
			hadError: boolean,
		) => Promise<void> | void,
	) => {
		this.disconnectHandler = handler;
	};

	onError = (handler: (error: unknown) => Promise<void> | void) => {
		this.errorHandler = handler;
	};

	private handleSocketConnected = async (socket: WebSocket) => {
		const id = nanoid();
		const connection: IWebSocketHostConnection = {
			id,
			send: async (message) => {
				await this.writeSocketFrame(socket, message);
			},
			close: async () => {
				await this.closeSocket(socket);
			},
		};
		const internal: IConnectionInternal = {
			connection,
			buffer: '',
		};
		this.connections.set(id, internal);
		await this.connectionHandler(connection);

		socket.on('message', (data) => {
			this.handleSocketData(id, data).catch((error) => {
				Promise.resolve(this.errorHandler(error)).catch(() => {});
			});
		});
		socket.on('close', (_code, _reason) => {
			this.connections.delete(id);
			Promise.resolve(this.disconnectHandler(connection, false)).catch(
				(error) => {
					Promise.resolve(this.errorHandler(error)).catch(() => {});
				},
			);
		});
		socket.on('error', (error) => {
			Promise.resolve(this.errorHandler(error)).catch(() => {});
		});
	};

	private handleSocketData = async (connectionId: string, data: RawData) => {
		const internal = this.connections.get(connectionId);
		if (!internal) {
			return;
		}

		const decoded = decodeEnvelopeFrames(dataToText(data), internal.buffer);
		internal.buffer = decoded.rest;
		for (const message of decoded.messages) {
			await this.messageHandler(internal.connection, message);
		}
	};

	private writeSocketFrame = async (
		socket: WebSocket,
		message: IProtocolEnvelope<string, unknown>,
	) => {
		if (socket.readyState !== WebSocket.OPEN) {
			throw new Error('WebSocket is not open');
		}

		await new Promise<void>((resolve, reject) => {
			socket.send(encodeEnvelopeFrame(message), (error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	};

	private closeSocket = async (socket: WebSocket) => {
		if (socket.readyState === WebSocket.CLOSED) {
			return;
		}

		await new Promise<void>((resolve) => {
			socket.once('close', () => {
				resolve();
			});
			if (socket.readyState === WebSocket.CLOSING) {
				return;
			}
			socket.close();
		});
	};
}
