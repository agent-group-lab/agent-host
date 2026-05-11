import { access, unlink } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import {
	decodeEnvelopeFrames,
	encodeEnvelopeFrame,
	type IProtocolEnvelope,
} from '@agent-group-lab/protocol';
import { nanoid } from 'nanoid';

interface IUdsHostConnection {
	id: string;
	send: (message: IProtocolEnvelope<string, unknown>) => Promise<void>;
	close: () => Promise<void>;
}

interface IConnectionInternal {
	connection: IUdsHostConnection;
	buffer: string;
}

const tryRemoveSocketFile = async (socketPath: string) => {
	try {
		await access(socketPath);
		await unlink(socketPath);
	} catch {
		// ignore if not exists
	}
};

const noopConnectionHandler = (_connection: IUdsHostConnection) => {};
const noopMessageHandler = (
	_connection: IUdsHostConnection,
	_message: IProtocolEnvelope<string, unknown>,
) => {};
const noopDisconnectHandler = (
	_connection: IUdsHostConnection,
	_hadError: boolean,
) => {};
const noopErrorHandler = (_error: unknown) => {};

export interface IUdsHostServerOptions {
	socketPath: string;
}

export class UdsHostServer {
	private readonly socketPath: string;
	private readonly connections = new Map<string, IConnectionInternal>();
	private server: Server | null = null;
	private connectionHandler: (
		connection: IUdsHostConnection,
	) => Promise<void> | void = noopConnectionHandler;
	private messageHandler: (
		connection: IUdsHostConnection,
		message: IProtocolEnvelope<string, unknown>,
	) => Promise<void> | void = noopMessageHandler;
	private disconnectHandler: (
		connection: IUdsHostConnection,
		hadError: boolean,
	) => Promise<void> | void = noopDisconnectHandler;
	private errorHandler: (error: unknown) => Promise<void> | void =
		noopErrorHandler;

	constructor(options: IUdsHostServerOptions) {
		this.socketPath = options.socketPath;
	}

	start = async () => {
		if (this.server) {
			return;
		}

		await tryRemoveSocketFile(this.socketPath);
		this.server = createServer((socket) => {
			this.handleSocketConnected(socket).catch((error) => {
				Promise.resolve(this.errorHandler(error)).catch(() => {});
			});
		});

		await new Promise<void>((resolve, reject) => {
			this.server?.once('error', reject);
			this.server?.listen(this.socketPath, () => {
				this.server?.off('error', reject);
				resolve();
			});
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

		await tryRemoveSocketFile(this.socketPath);
	};

	onConnection = (
		handler: (connection: IUdsHostConnection) => Promise<void> | void,
	) => {
		this.connectionHandler = handler;
	};

	onMessage = (
		handler: (
			connection: IUdsHostConnection,
			message: IProtocolEnvelope<string, unknown>,
		) => Promise<void> | void,
	) => {
		this.messageHandler = handler;
	};

	onDisconnect = (
		handler: (
			connection: IUdsHostConnection,
			hadError: boolean,
		) => Promise<void> | void,
	) => {
		this.disconnectHandler = handler;
	};

	onError = (handler: (error: unknown) => Promise<void> | void) => {
		this.errorHandler = handler;
	};

	private handleSocketConnected = async (socket: Socket) => {
		const id = nanoid();
		const connection: IUdsHostConnection = {
			id,
			send: async (message) => {
				await this.writeSocketFrame(socket, message);
			},
			close: async () => {
				socket.end();
				socket.destroy();
			},
		};
		const internal: IConnectionInternal = {
			connection,
			buffer: '',
		};
		this.connections.set(id, internal);
		await this.connectionHandler(connection);

		socket.on('data', (chunk) => {
			this.handleSocketData(id, chunk.toString()).catch((error) => {
				Promise.resolve(this.errorHandler(error)).catch(() => {});
			});
		});
		socket.on('close', (hadError) => {
			this.connections.delete(id);
			Promise.resolve(this.disconnectHandler(connection, hadError)).catch(
				(error) => {
					Promise.resolve(this.errorHandler(error)).catch(() => {});
				},
			);
		});
		socket.on('error', (error) => {
			Promise.resolve(this.errorHandler(error)).catch(() => {});
		});
	};

	private handleSocketData = async (connectionId: string, chunk: string) => {
		const internal = this.connections.get(connectionId);
		if (!internal) {
			return;
		}

		const decoded = decodeEnvelopeFrames(chunk, internal.buffer);
		internal.buffer = decoded.rest;
		for (const message of decoded.messages) {
			await this.messageHandler(internal.connection, message);
		}
	};

	private writeSocketFrame = async (
		socket: Socket,
		message: IProtocolEnvelope<string, unknown>,
	) => {
		await new Promise<void>((resolve, reject) => {
			socket.write(encodeEnvelopeFrame(message), (error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	};
}
