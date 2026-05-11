import {
	type IWorkerSummary,
	type IWorkersListPayload,
	parseWorkersListResultPayload,
	WORKERS_LIST,
	WORKERS_LIST_RESULT,
} from '@agent-group-lab/contracts/messages';
import type { IProtocolEnvelope } from '@agent-group-lab/protocol';
import type { IWorkerClientPort } from '~/ports/worker-client-port';

interface IPeerDirectoryOptions {
	clientPort: IWorkerClientPort;
	createEnvelope: (
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => IProtocolEnvelope<string, unknown>;
	agentId: string;
	peerDirectoryCacheTtlMs: number;
	peerDirectoryFetchTimeoutMs: number;
	log: (message: string) => void;
}

export class PeerDirectory {
	private readonly options: IPeerDirectoryOptions;
	private cache:
		| {
				peers: IWorkerSummary[];
				expiresAt: number;
		  }
		| undefined;
	private pendingFetch: Promise<IWorkerSummary[]> | undefined;

	constructor(options: IPeerDirectoryOptions) {
		this.options = options;
	}

	fetchPeers = async () => {
		const now = Date.now();
		const cached = this.cache;
		if (cached && cached.expiresAt > now) {
			return cached.peers;
		}
		if (this.pendingFetch) {
			return await this.pendingFetch;
		}

		const fetchPromise = this.fetchPeersOnce(cached, now);
		this.pendingFetch = fetchPromise;
		try {
			return await fetchPromise;
		} finally {
			if (this.pendingFetch === fetchPromise) {
				this.pendingFetch = undefined;
			}
		}
	};

	clearCache = () => {
		this.cache = undefined;
		this.pendingFetch = undefined;
	};

	private fetchPeersOnce = async (
		cached: { peers: IWorkerSummary[] } | undefined,
		now: number,
	) => {
		const payload: IWorkersListPayload = {
			includeOffline: false,
		};
		try {
			await this.options.clientPort.send(
				this.options.createEnvelope({
					type: WORKERS_LIST,
					channel: 'control',
					payload,
				}),
			);
			const response = await this.options.clientPort.waitForMessage(
				(message) => message.type === WORKERS_LIST_RESULT,
				this.options.peerDirectoryFetchTimeoutMs,
			);
			const parsed = parseWorkersListResultPayload(response.payload);
			if (!parsed) {
				this.options.log('[warn] Invalid workers:list:result payload');
				return this.fallbackCache(cached, now);
			}
			const peers = parsed.workers.filter(
				(worker) => worker.agentId !== this.options.agentId,
			);
			this.cache = {
				peers,
				expiresAt: now + this.options.peerDirectoryCacheTtlMs,
			};
			return peers;
		} catch (error) {
			this.options.log(
				`[warn] Unable to fetch peers: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return this.fallbackCache(cached, now);
		}
	};

	private fallbackCache = (
		cached: { peers: IWorkerSummary[] } | undefined,
		now: number,
	) => {
		const peers = cached?.peers ?? [];
		this.cache = {
			peers,
			expiresAt: now + this.options.peerDirectoryCacheTtlMs,
		};
		return peers;
	};
}
