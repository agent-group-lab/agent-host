import { cwd } from 'node:process';
import {
	DIRECT_CANCEL,
	DIRECT_REQUEST,
	DIRECT_RESPONSE,
	type IDirectCancelPayload,
	type IDirectRequestPayload,
	type IDirectResponsePayload,
	parseDirectCancelPayload,
	parseDirectRequestPayload,
	parseDirectResponsePayload,
} from '@agent-group-lab/contracts/messages';
import type {
	IProtocolEnvelope,
	IProtocolErrorPayload,
} from '@agent-group-lab/protocol';
import { nanoid } from 'nanoid';
import type { IWorkerClientPort } from '~/ports/worker-client-port';
import type { TaskExecutor } from './task-executor';

interface IPendingDirectRequest {
	requestId: string;
	toAgentId: string;
	toAgentName: string;
	sourceTaskId?: string;
	createdAt: number;
	timeoutAt: number;
	timeoutTimer: ReturnType<typeof setTimeout>;
	resolve: (payload: IDirectResponsePayload) => void;
	reject: (error: Error) => void;
}

interface IDirectPeerOptions {
	clientPort: IWorkerClientPort;
	agentId: string;
	agentName: string;
	createEnvelope: (
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => IProtocolEnvelope<string, unknown>;
	log: (message: string) => void;
	getActiveTaskId: () => string | null;
	executeDirectRequest: TaskExecutor['executeDirectRequest'];
	resolveCurrentSourceTaskId: () => string | undefined;
	directDefaultTimeoutMs: number;
	directDefaultTtlMs: number;
	directMaxHops: number;
	directMaxPendingOutbound: number;
}

export interface ISendDirectRequestAndWaitInput {
	toAgentId: string;
	toAgentName: string;
	prompt: string;
	workingDirectory?: string;
	sourceTaskId?: string;
	timeoutMs?: number;
	ttlMs?: number;
	hopCount?: number;
	maxHops?: number;
	requestChain?: string[];
	intent?: string;
}

export class DirectPeer {
	private readonly options: IDirectPeerOptions;
	private readonly pendingDirectRequests = new Map<
		string,
		IPendingDirectRequest
	>();

	constructor(options: IDirectPeerOptions) {
		this.options = options;
	}

	sendDirectRequestAndWait = async (input: ISendDirectRequestAndWaitInput) => {
		if (
			this.pendingDirectRequests.size >= this.options.directMaxPendingOutbound
		) {
			throw new Error('Too many pending outbound direct requests');
		}

		const requestId = nanoid();
		const createdAt = Date.now();
		const timeoutMs = input.timeoutMs ?? this.options.directDefaultTimeoutMs;
		const timeoutAt = createdAt + timeoutMs;
		const ttlMs =
			input.ttlMs ?? Math.min(this.options.directDefaultTtlMs, timeoutMs);
		const payload: IDirectRequestPayload = {
			requestId,
			fromAgentId: this.options.agentId,
			fromAgentName: this.options.agentName,
			toAgentId: input.toAgentId,
			toAgentName: input.toAgentName,
			prompt: input.prompt,
			workingDirectory: input.workingDirectory ?? cwd(),
			sourceTaskId:
				input.sourceTaskId ?? this.options.resolveCurrentSourceTaskId(),
			timeoutMs,
			ttlMs,
			hopCount: input.hopCount ?? 0,
			maxHops: input.maxHops ?? this.options.directMaxHops,
			requestChain: input.requestChain,
			intent: input.intent,
		};

		const responsePromise = new Promise<IDirectResponsePayload>(
			(resolve, reject) => {
				const timeoutTimer = setTimeout(() => {
					this.pendingDirectRequests.delete(requestId);
					this.sendDirectCancel({
						requestId,
						toAgentId: payload.toAgentId,
						toAgentName: payload.toAgentName,
						sourceTaskId: payload.sourceTaskId,
						reasonCode: 'requester_timeout',
					}).catch((error) => {
						this.options.log(
							`[warn] failed to send direct:cancel ${requestId}: ${
								error instanceof Error ? error.message : String(error)
							}`,
						);
					});
					reject(
						new Error(
							`Direct request ${requestId} to ${payload.toAgentId} timed out`,
						),
					);
				}, timeoutMs);

				this.pendingDirectRequests.set(requestId, {
					requestId,
					toAgentId: payload.toAgentId,
					toAgentName: payload.toAgentName,
					sourceTaskId: payload.sourceTaskId,
					createdAt,
					timeoutAt,
					timeoutTimer,
					resolve,
					reject,
				});
			},
		);

		try {
			await this.options.clientPort.send(
				this.options.createEnvelope({
					type: DIRECT_REQUEST,
					channel: `direct:${requestId}`,
					payload,
				}),
			);
		} catch (error) {
			const pending = this.pendingDirectRequests.get(requestId);
			if (pending) {
				clearTimeout(pending.timeoutTimer);
				this.pendingDirectRequests.delete(requestId);
			}
			throw error;
		}

		return await responsePromise;
	};

	handleDirectRequest = async (message: IProtocolEnvelope) => {
		const parsed = parseDirectRequestPayload(message.payload);
		if (!parsed) {
			await this.options.clientPort.send(
				this.options.createEnvelope({
					type: 'control:error',
					channel: 'control',
					payload: {
						code: 'protocol',
						message: 'Invalid direct:request payload',
					} satisfies IProtocolErrorPayload,
				}),
			);
			return;
		}

		const execution = await this.options.executeDirectRequest({
			requestId: parsed.requestId,
			prompt: parsed.prompt,
			workingDirectory: parsed.workingDirectory,
			caller: {
				kind: 'agent',
				agentId: parsed.fromAgentId,
				agentName: parsed.fromAgentName,
			},
		});
		if (execution.status === 'busy') {
			const busyResponse: IDirectResponsePayload = {
				requestId: parsed.requestId,
				fromAgentId: parsed.toAgentId,
				fromAgentName: parsed.toAgentName,
				toAgentId: parsed.fromAgentId,
				toAgentName: parsed.fromAgentName,
				action: 'ACK',
				origin: 'worker',
				ackKind: 'peer_rejected',
				reasonCode: 'busy',
				reason: `Worker is busy with task ${execution.activeTaskId}`,
			};
			await this.options.clientPort.send(
				this.options.createEnvelope({
					type: DIRECT_RESPONSE,
					channel: `direct:${parsed.requestId}`,
					payload: busyResponse,
				}),
			);
			return;
		}
		if (execution.status === 'delivered') {
			const deliverResponse: IDirectResponsePayload = {
				requestId: parsed.requestId,
				fromAgentId: parsed.toAgentId,
				fromAgentName: parsed.toAgentName,
				toAgentId: parsed.fromAgentId,
				toAgentName: parsed.fromAgentName,
				action: 'DELIVER',
				origin: 'worker',
				content: execution.content,
			};
			await this.options.clientPort.send(
				this.options.createEnvelope({
					type: DIRECT_RESPONSE,
					channel: `direct:${parsed.requestId}`,
					payload: deliverResponse,
				}),
			);
			return;
		}

		const failResponse: IDirectResponsePayload = {
			requestId: parsed.requestId,
			fromAgentId: parsed.toAgentId,
			fromAgentName: parsed.toAgentName,
			toAgentId: parsed.fromAgentId,
			toAgentName: parsed.fromAgentName,
			action: 'ACK',
			origin: 'worker',
			ackKind: 'peer_rejected',
			reasonCode: 'rejected',
			reason: execution.reason,
		};
		await this.options.clientPort.send(
			this.options.createEnvelope({
				type: DIRECT_RESPONSE,
				channel: `direct:${parsed.requestId}`,
				payload: failResponse,
			}),
		);
	};

	handleDirectResponse = async (message: IProtocolEnvelope) => {
		const parsed = parseDirectResponsePayload(message.payload);
		if (!parsed) {
			await this.options.clientPort.send(
				this.options.createEnvelope({
					type: 'control:error',
					channel: 'control',
					payload: {
						code: 'protocol',
						message: 'Invalid direct:response payload',
					} satisfies IProtocolErrorPayload,
				}),
			);
			return;
		}

		const pending = this.pendingDirectRequests.get(parsed.requestId);
		if (!pending) {
			this.options.log(
				`[audit] late_response_dropped requestId=${parsed.requestId}`,
			);
			return;
		}
		// Compatibility guard:
		// older peers may only set reasonCode='queued', while newer peers use ackKind='queued'.
		// treat either field as queued ACK to keep wire behavior backward-compatible.
		if (
			parsed.action === 'ACK' &&
			(parsed.ackKind === 'queued' || parsed.reasonCode === 'queued')
		) {
			this.options.log(
				`[direct] queued requestId=${parsed.requestId} to=${pending.toAgentId}`,
			);
			return;
		}

		clearTimeout(pending.timeoutTimer);
		this.pendingDirectRequests.delete(parsed.requestId);
		pending.resolve(parsed);
	};

	handleDirectCancel = async (message: IProtocolEnvelope) => {
		const parsed = parseDirectCancelPayload(message.payload);
		if (!parsed) {
			await this.options.clientPort.send(
				this.options.createEnvelope({
					type: 'control:error',
					channel: 'control',
					payload: {
						code: 'protocol',
						message: 'Invalid direct:cancel payload',
					} satisfies IProtocolErrorPayload,
				}),
			);
			return;
		}

		if (this.options.getActiveTaskId() === `direct:${parsed.requestId}`) {
			this.options.log(
				`[audit] direct_cancel_received requestId=${parsed.requestId}`,
			);
		}
	};

	rejectAllPending = (error: Error) => {
		for (const pending of this.pendingDirectRequests.values()) {
			clearTimeout(pending.timeoutTimer);
			pending.reject(error);
		}
		this.pendingDirectRequests.clear();
	};

	private sendDirectCancel = async (input: {
		requestId: string;
		toAgentId: string;
		toAgentName: string;
		sourceTaskId?: string;
		reasonCode?: IDirectCancelPayload['reasonCode'];
	}) => {
		const payload: IDirectCancelPayload = {
			requestId: input.requestId,
			fromAgentId: this.options.agentId,
			fromAgentName: this.options.agentName,
			toAgentId: input.toAgentId,
			toAgentName: input.toAgentName,
			sourceTaskId: input.sourceTaskId,
			reasonCode: input.reasonCode,
		};
		await this.options.clientPort.send(
			this.options.createEnvelope({
				type: DIRECT_CANCEL,
				channel: `direct:${input.requestId}`,
				payload,
			}),
		);
	};
}
