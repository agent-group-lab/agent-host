import type {
	DirectReasonCode,
	IDirectRequestPayload,
} from '@agent-group-lab/contracts/messages';

export interface IDirectAdmissionDecision {
	allowed: boolean;
	code?: string;
	reason?: string;
	reasonCode?: DirectReasonCode;
}

export interface IDirectAdmissionContext {
	now: number;
	messageTs: number;
	senderRole: 'unknown' | 'worker' | 'client';
	senderAgentId?: string;
	targetConnectionId?: string;
	queuedForTarget: number;
}

export interface IDirectAdmissionGuard {
	evaluate: (
		payload: IDirectRequestPayload,
		context: IDirectAdmissionContext,
	) => IDirectAdmissionDecision;
}

export interface IDirectAdmissionGuardOptions {
	defaultTimeoutMs?: number;
	defaultTtlMs?: number;
	maxHops?: number;
	maxQueuedPerTarget?: number;
	rateLimitMaxRequestsPerWindow?: number;
	rateLimitWindowMs?: number;
}

const defaults = {
	defaultTimeoutMs: 60_000,
	defaultTtlMs: 60_000,
	maxHops: 3,
	maxQueuedPerTarget: 32,
	rateLimitMaxRequestsPerWindow: 20,
	rateLimitWindowMs: 60_000,
} as const;

export class DirectAdmissionGuard implements IDirectAdmissionGuard {
	private readonly options: Required<IDirectAdmissionGuardOptions>;
	private readonly requestTimestamps = new Map<string, number[]>();

	constructor(options?: IDirectAdmissionGuardOptions) {
		this.options = {
			defaultTimeoutMs: options?.defaultTimeoutMs ?? defaults.defaultTimeoutMs,
			defaultTtlMs: options?.defaultTtlMs ?? defaults.defaultTtlMs,
			maxHops: options?.maxHops ?? defaults.maxHops,
			maxQueuedPerTarget:
				options?.maxQueuedPerTarget ?? defaults.maxQueuedPerTarget,
			rateLimitMaxRequestsPerWindow:
				options?.rateLimitMaxRequestsPerWindow ??
				defaults.rateLimitMaxRequestsPerWindow,
			rateLimitWindowMs:
				options?.rateLimitWindowMs ?? defaults.rateLimitWindowMs,
		};
	}

	evaluate = (
		payload: IDirectRequestPayload,
		context: IDirectAdmissionContext,
	): IDirectAdmissionDecision => {
		if (
			context.senderRole === 'worker' &&
			context.senderAgentId !== payload.fromAgentId
		) {
			return {
				allowed: false,
				code: 'identity_mismatch',
				reason: `Worker ${context.senderAgentId ?? 'unknown'} cannot send as ${payload.fromAgentId}`,
				reasonCode: 'other',
			};
		}

		if (payload.fromAgentId === payload.toAgentId) {
			return {
				allowed: false,
				code: 'self_direct',
				reason: 'Self direct request is not allowed',
				reasonCode: 'other',
			};
		}

		if (!context.targetConnectionId) {
			return {
				allowed: false,
				code: 'target_offline',
				reason: `Agent ${payload.toAgentId} is offline`,
				reasonCode: 'target_offline',
			};
		}

		if (context.queuedForTarget >= this.options.maxQueuedPerTarget) {
			return {
				allowed: false,
				code: 'queue_full',
				reason: `Queue for ${payload.toAgentId} is full`,
				reasonCode: 'queue_full',
			};
		}

		if (!this.isTtlValid(payload, context)) {
			return {
				allowed: false,
				code: 'ttl_expired',
				reason: 'Direct request TTL expired',
				reasonCode: 'ttl_expired',
			};
		}

		const maxHops = payload.maxHops ?? this.options.maxHops;
		const hopCount = payload.hopCount ?? 0;
		if (hopCount > maxHops) {
			return {
				allowed: false,
				code: 'depth_exceeded',
				reason: `hopCount ${hopCount} exceeds maxHops ${maxHops}`,
				reasonCode: 'depth_exceeded',
			};
		}

		const chain = payload.requestChain ?? [];
		if (chain.includes(payload.toAgentId)) {
			return {
				allowed: false,
				code: 'loop_detected',
				reason: `requestChain already contains ${payload.toAgentId}`,
				reasonCode: 'loop_detected',
			};
		}

		if (!this.consumeRate(payload.fromAgentId, context.now)) {
			return {
				allowed: false,
				code: 'rate_limited',
				reason: `Rate limited for ${payload.fromAgentId}`,
				reasonCode: 'rate_limited',
			};
		}

		return { allowed: true };
	};

	private isTtlValid = (
		payload: IDirectRequestPayload,
		context: IDirectAdmissionContext,
	) => {
		const effectiveTimeoutMs =
			payload.timeoutMs ?? this.options.defaultTimeoutMs;
		const effectiveTtlMs =
			payload.ttlMs ?? Math.min(this.options.defaultTtlMs, effectiveTimeoutMs);
		const expiresAt = context.messageTs + effectiveTtlMs;
		return expiresAt >= context.now;
	};

	private consumeRate = (agentId: string, now: number) => {
		const windowStart = now - this.options.rateLimitWindowMs;
		const current = this.requestTimestamps.get(agentId) ?? [];
		const recent = current.filter((ts) => ts >= windowStart);
		if (recent.length >= this.options.rateLimitMaxRequestsPerWindow) {
			this.requestTimestamps.set(agentId, recent);
			return false;
		}
		recent.push(now);
		this.requestTimestamps.set(agentId, recent);
		return true;
	};
}
