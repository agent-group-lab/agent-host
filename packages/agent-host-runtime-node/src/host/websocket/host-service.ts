import {
	HostCore,
	type IDirectAdmissionGuardOptions,
	type IHostStore,
	type IStoreSnapshot,
} from '@agent-group-lab/agent-host/host';
import type { IAgentEventEnvelope } from '@agent-group-lab/contracts/agent';
import type { ITransitionEvent } from '@agent-group-lab/contracts/events';
import type {
	IHostCheckpoint,
	ITimelineEntry,
} from '@agent-group-lab/contracts/timeline';
import { FileStore, isHostPersistentStore } from '~/store/file-store';
import { WebSocketHostServer } from '~/transport/websocket/websocket-server';

interface IBreachDetectionOptions {
	enabled?: boolean;
	intervalMs?: number;
	now?: () => number;
	reason?: string;
}

export interface IStartHostServiceOptions {
	port: number;
	host?: string;
	path?: string;
	store?: IHostStore;
	storeDir?: string;
	onLog?: (message: string) => void;
	onAgentEvent?: (payload: IAgentEventEnvelope) => void;
	onTransitionEvents?: (events: ITransitionEvent[]) => void;
	onTimeline?: (entry: ITimelineEntry, sessionStartedAt: number) => void;
	directAdmission?: IDirectAdmissionGuardOptions;
	breachDetection?: IBreachDetectionOptions;
	taskClaimV2Enabled?: boolean;
	preferredHoldMs?: number;
}

export interface IHostService {
	close: () => Promise<void>;
	waitUntilClosed: () => Promise<void>;
	checkpoint: () => IHostCheckpoint<IStoreSnapshot>;
}

const formatEndpoint = (options: IStartHostServiceOptions) => {
	const host = options.host ?? '127.0.0.1';
	const path = options.path ?? '';
	return `ws://${host}:${options.port}${path}`;
};

class WebSocketHostRuntime implements IHostService {
	private readonly adapter: WebSocketHostServer;
	private readonly core: HostCore;
	private readonly store: IHostStore;
	private readonly closePromise: Promise<void>;
	private resolveClosed: (() => void) | null = null;

	constructor(private readonly options: IStartHostServiceOptions) {
		this.store = options.store ?? new FileStore({ dir: options.storeDir });
		if (isHostPersistentStore(this.store)) {
			this.store.load();
		}

		this.core = new HostCore({
			store: this.store,
			onLog: options.onLog,
			eventOutputPort: {
				onTransitionEvents: (events) => {
					options.onTransitionEvents?.(events);
				},
				onAgentEvent: (payload) => {
					options.onAgentEvent?.(payload);
				},
				onTimeline: (entry, sessionStartedAt) => {
					options.onTimeline?.(entry, sessionStartedAt);
				},
			},
			directAdmission: options.directAdmission,
			taskClaimV2Enabled: options.taskClaimV2Enabled,
			preferredHoldMs: options.preferredHoldMs,
			breachDetection: options.breachDetection ?? {
				enabled: true,
			},
		});
		this.adapter = new WebSocketHostServer({
			host: options.host,
			path: options.path,
			port: options.port,
		});

		this.adapter.onConnection(this.core.handleConnection);
		this.adapter.onMessage(this.core.handleMessage);
		this.adapter.onDisconnect(this.core.handleDisconnect);
		this.adapter.onError(this.core.handleTransportError);

		this.closePromise = new Promise<void>((resolve) => {
			this.resolveClosed = resolve;
		});
	}

	start = async () => {
		await this.adapter.start();
		this.options.onLog?.(`Host listening on ${formatEndpoint(this.options)}`);
	};

	close = async () => {
		await this.adapter.stop();
		await this.core.close();
		if (isHostPersistentStore(this.store)) {
			this.store.flush();
		}
		if (this.resolveClosed) {
			this.resolveClosed();
			this.resolveClosed = null;
		}
	};

	waitUntilClosed = async () => {
		await this.closePromise;
	};

	checkpoint = () => {
		return this.core.checkpoint();
	};
}

export const startHostService = async (
	options: IStartHostServiceOptions,
): Promise<IHostService> => {
	const runtime = new WebSocketHostRuntime(options);
	await runtime.start();
	return runtime;
};
