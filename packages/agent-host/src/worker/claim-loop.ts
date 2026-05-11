import {
	type ITaskClaimResultPayload,
	TASK_CLAIM,
} from '@agent-group-lab/contracts/messages';
import type { IProtocolEnvelope } from '@agent-group-lab/protocol';
import { nanoid } from 'nanoid';
import type { IWorkerClientPort } from '~/ports/worker-client-port';

interface IClaimLoopOptions {
	clientPort: IWorkerClientPort;
	createEnvelope: (
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => IProtocolEnvelope<string, unknown>;
	agentId: string;
	claimLeaseMs: number;
	claimBackoffBaseMs: number;
	claimBackoffMaxMs: number;
	log: (message: string) => void;
	canRequestClaim: () => boolean;
}

export class ClaimLoop {
	private readonly options: IClaimLoopOptions;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private pendingRequestId: string | null = null;
	private running = false;
	private backoffMs: number;

	constructor(options: IClaimLoopOptions) {
		this.options = options;
		this.backoffMs = options.claimBackoffBaseMs;
	}

	start = () => {
		if (this.running) {
			return;
		}
		this.running = true;
		this.schedule(100);
	};

	stop = () => {
		this.running = false;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.pendingRequestId = null;
	};

	onClaimResult = (payload: ITaskClaimResultPayload) => {
		if (payload.requestId !== this.pendingRequestId) {
			return;
		}
		this.pendingRequestId = null;
		if (payload.status === 'claimed') {
			this.backoffMs = this.options.claimBackoffBaseMs;
			return;
		}
		if (payload.reasonCode === 'preferred_window_active') {
			this.schedule(this.jitter(500, 150));
			return;
		}
		if (payload.status === 'none') {
			this.backoffMs = Math.min(
				this.backoffMs * 2,
				this.options.claimBackoffMaxMs,
			);
		}
		this.schedule(this.jitter(this.backoffMs, 300));
	};

	triggerSoon = () => {
		if (!this.running || this.pendingRequestId) {
			return;
		}
		this.schedule(100);
	};

	private requestClaim = async () => {
		if (
			!this.running ||
			this.pendingRequestId ||
			!this.options.canRequestClaim()
		) {
			this.schedule(this.jitter(this.backoffMs, 300));
			return;
		}
		const requestId = nanoid();
		this.pendingRequestId = requestId;
		await this.options.clientPort.send(
			this.options.createEnvelope({
				type: TASK_CLAIM,
				channel: `task:${requestId}`,
				payload: {
					requestId,
					claimLeaseMs: this.options.claimLeaseMs,
				},
			}),
		);
	};

	private schedule = (ms: number) => {
		if (!this.running) {
			return;
		}
		if (this.timer) {
			clearTimeout(this.timer);
		}
		this.timer = setTimeout(() => {
			this.requestClaim().catch((error) => {
				this.options.log(
					`[claim-loop] request failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
				this.pendingRequestId = null;
				this.schedule(this.jitter(this.backoffMs, 300));
			});
		}, ms);
	};

	private jitter = (baseMs: number, maxJitter: number) => {
		return baseMs + Math.floor(Math.random() * (maxJitter + 1));
	};
}
