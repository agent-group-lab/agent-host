import { ControlStateMachine } from '@agent-group-lab/protocol';
import type { IHostPortConnection } from '~/ports/host-server-port';
import type { IConnectionMeta, IConnectionStore } from '~/store/store';

export interface ILiveConnectionState {
	connection: IHostPortConnection;
	control: ControlStateMachine;
}

export interface IConnectionContext {
	meta: IConnectionMeta;
	live: ILiveConnectionState;
}

export class ConnectionManager {
	private readonly store: IConnectionStore;
	private readonly liveConnections = new Map<string, ILiveConnectionState>();

	constructor(store: IConnectionStore) {
		this.store = store;
	}

	open = (connection: IHostPortConnection) => {
		this.rehydrate(connection);
	};

	rehydrate = (connection: IHostPortConnection, meta?: IConnectionMeta) => {
		const existing = this.store.getConnection(connection.id);
		const nextMeta = meta ?? existing ?? this.createDefaultMeta(connection.id);
		this.store.setConnection({
			...nextMeta,
			connectionId: connection.id,
		});
		const initialControlState = nextMeta.ready ? 'active' : 'init';
		this.liveConnections.set(connection.id, {
			connection,
			control: new ControlStateMachine(initialControlState),
		});
	};

	close = (connectionId: string) => {
		const context = this.getContext(connectionId);
		if (!context) {
			return null;
		}
		this.store.deleteConnection(connectionId);
		this.liveConnections.delete(connectionId);
		return context;
	};

	getContext = (connectionId: string) => {
		const meta = this.store.getConnection(connectionId);
		const live = this.liveConnections.get(connectionId);
		if (!meta || !live) {
			return null;
		}
		return { meta, live } satisfies IConnectionContext;
	};

	getLiveConnection = (connectionId: string) => {
		return this.liveConnections.get(connectionId);
	};

	getConnection = (connectionId: string) => {
		return this.liveConnections.get(connectionId)?.connection;
	};

	updateConnectionMeta = (
		connectionId: string,
		updates: Partial<IConnectionMeta>,
	) => {
		const current = this.store.getConnection(connectionId);
		if (!current) {
			return;
		}
		this.store.setConnection({
			...current,
			...updates,
		});
	};

	private createDefaultMeta = (connectionId: string): IConnectionMeta => {
		return {
			connectionId,
			connectionRole: 'unknown',
			ready: false,
			connectedAt: Date.now(),
		};
	};
}
