import {
	DIRECT_CANCEL,
	DIRECT_RESPONSE,
	type DirectReasonCode,
	type IDirectCancelPayload,
	type IDirectRequestPayload,
	type IDirectResponsePayload,
} from '@agent-group-lab/contracts/messages';
import type {
	IProtocolEnvelope,
	IProtocolErrorPayload,
	IProtocolTrace,
} from '@agent-group-lab/protocol';
import { nanoid } from 'nanoid';
import { createDirectInboxWorkRef } from '~/domain/inbox';
import type { IDirectAdmissionGuard } from '~/policy/direct-admission-guard';
import type { ITriage } from '~/policy/triage';
import type { IHostPortConnection } from '~/ports/host-server-port';
import type { IConnectionContext } from '../infra/connection-manager';
import type { IInbox } from '../infra/inbox';
import type { IMailbox } from '../infra/mailbox';

interface IDirectHandlerOptions {
	inbox: IInbox;
	mailbox: IMailbox;
	triage: ITriage;
	directAdmissionGuard: IDirectAdmissionGuard;
	sendProtocolError: (
		connection: IHostPortConnection,
		code: IProtocolErrorPayload['code'],
		message: string,
		details?: Record<string, unknown>,
	) => Promise<void>;
	sendToConnection: (
		connectionId: string,
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => Promise<void>;
	sendHostAck: (input: {
		requesterConnectionId: string;
		request: Pick<
			IDirectRequestPayload,
			| 'requestId'
			| 'fromAgentId'
			| 'fromAgentName'
			| 'toAgentId'
			| 'toAgentName'
		>;
		trace: IProtocolTrace | undefined;
		ackKind: 'queued' | 'admission_rejected';
		reasonCode: DirectReasonCode;
		reason: string;
	}) => Promise<void>;
	markWorkerWaitingPeer: (
		context: IConnectionContext,
		request: IDirectRequestPayload,
	) => void;
	restoreRequesterWorkState: (
		agentId: string,
		requestId: string,
		sourceTaskId?: string,
	) => void;
	resolveRequesterConnection: (parsed: {
		requestId: string;
		fromAgentId: string;
		toAgentId: string;
	}) => string | undefined;
	completeWork: (input: {
		agentId: string;
		workKind: 'task' | 'direct';
		workId: string;
		outcome: 'completed' | 'dropped';
	}) => void;
	dispatchNextWorkForWorker: (agentId: string) => Promise<void>;
	log: (message: string) => void;
}

export class DirectHandler {
	private readonly options: IDirectHandlerOptions;

	constructor(options: IDirectHandlerOptions) {
		this.options = options;
	}

	handleDirectRequest = async (
		context: IConnectionContext,
		parsed: IDirectRequestPayload,
		trace: IProtocolTrace | undefined,
		messageTs: number,
	) => {
		if (
			context.meta.connectionRole === 'worker' &&
			context.meta.agentId !== parsed.fromAgentId
		) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'fromAgentId mismatch: sender identity does not match registered agent',
				{ fromAgentId: parsed.fromAgentId, registeredId: context.meta.agentId },
			);
			return;
		}

		const existing = this.options.inbox.findByRequestId(
			parsed.toAgentId,
			parsed.requestId,
		);
		if (existing) {
			this.options.log(
				`Duplicate direct:request ${parsed.requestId} for ${parsed.toAgentId}, ignoring`,
			);
			return;
		}

		const targetConnectionId = this.options.mailbox.resolve(parsed.toAgentId);
		const admission = this.options.directAdmissionGuard.evaluate(parsed, {
			now: Date.now(),
			messageTs,
			senderRole: context.meta.connectionRole,
			senderAgentId: context.meta.agentId,
			targetConnectionId,
			queuedForTarget: this.options.inbox.getDispatchCandidates(
				parsed.toAgentId,
			).length,
		});
		if (!admission.allowed) {
			await this.options.sendHostAck({
				requesterConnectionId: context.meta.connectionId,
				request: parsed,
				trace,
				ackKind: 'admission_rejected',
				reasonCode: admission.reasonCode ?? 'other',
				reason:
					admission.reason ??
					`Direct request rejected (${admission.code ?? 'admission'})`,
			});
			return;
		}
		if (!targetConnectionId) {
			return;
		}

		this.options.markWorkerWaitingPeer(context, parsed);

		const entryId = nanoid();
		const entry = this.options.inbox.add({
			entryId,
			toAgentId: parsed.toAgentId,
			toAgentName: parsed.toAgentName,
			fromAgentId: parsed.fromAgentId,
			fromAgentName: parsed.fromAgentName,
			requestId: parsed.requestId,
			work: createDirectInboxWorkRef({
				toAgentId: parsed.toAgentId,
				fromAgentId: parsed.fromAgentId,
				requestId: parsed.requestId,
				deadline:
					typeof parsed.ttlMs === 'number'
						? messageTs + parsed.ttlMs
						: undefined,
				sourceTaskId: parsed.sourceTaskId,
			}),
			payload: {
				...parsed,
				requesterConnectionId: context.meta.connectionId,
			},
		});

		const decision = this.options.triage.evaluate({
			toAgentId: parsed.toAgentId,
			fromAgentId: parsed.fromAgentId,
			requestId: parsed.requestId,
		});
		this.options.log(
			`Triage ${parsed.requestId}: ${decision.action} (${decision.ruleName})`,
		);

		if (decision.action === 'deliver') {
			await this.options.dispatchNextWorkForWorker(parsed.toAgentId);
			const latest = this.options.inbox.get(entry.entryId);
			if (latest?.status === 'dispatched') {
				await this.options.sendHostAck({
					requesterConnectionId: context.meta.connectionId,
					request: parsed,
					trace,
					ackKind: 'queued',
					reasonCode: 'queued',
					reason: 'Request accepted and dispatched',
				});
			} else if (latest?.status === 'queued') {
				await this.options.sendHostAck({
					requesterConnectionId: context.meta.connectionId,
					request: parsed,
					trace,
					ackKind: 'queued',
					reasonCode: 'queued',
					reason: 'Request queued: worker unavailable',
				});
			}
		} else if (decision.action === 'drop') {
			this.options.inbox.transition(entry.entryId, 'dropped');
			await this.options.sendHostAck({
				requesterConnectionId: context.meta.connectionId,
				request: parsed,
				trace,
				ackKind: 'admission_rejected',
				reasonCode: 'other',
				reason: `Request dropped (${decision.ruleName})`,
			});
		} else {
			await this.options.sendHostAck({
				requesterConnectionId: context.meta.connectionId,
				request: parsed,
				trace,
				ackKind: 'queued',
				reasonCode: 'queued',
				reason: `Request queued: agent is busy (${decision.ruleName})`,
			});
		}
	};

	handleDirectResponse = async (
		context: IConnectionContext,
		parsed: IDirectResponsePayload,
		trace: IProtocolTrace | undefined,
	) => {
		if (context.meta.connectionRole !== 'worker' || !context.meta.agentId) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'Only worker connections can send direct:response',
			);
			return;
		}

		if (context.meta.agentId !== parsed.fromAgentId) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'Worker mismatch for direct:response',
				{ requestId: parsed.requestId, fromAgentId: parsed.fromAgentId },
			);
			return;
		}

		const normalized = this.normalizeWorkerDirectResponse(parsed);
		const entry = this.options.inbox.findByRequestId(
			normalized.fromAgentId,
			normalized.requestId,
		);
		const storedPayload = entry?.payload;
		const sourceTaskId =
			typeof storedPayload?.sourceTaskId === 'string'
				? storedPayload.sourceTaskId
				: undefined;

		const requesterConnectionId =
			this.options.resolveRequesterConnection(normalized);
		if (!requesterConnectionId) {
			this.options.log(
				`Cannot route direct:response ${normalized.requestId}: requester not found`,
			);
			return;
		}

		await this.options.sendToConnection(requesterConnectionId, {
			type: DIRECT_RESPONSE,
			channel: `direct:${normalized.requestId}`,
			trace,
			payload: normalized,
		});
		this.options.restoreRequesterWorkState(
			normalized.toAgentId,
			normalized.requestId,
			sourceTaskId,
		);
		this.options.completeWork({
			agentId: normalized.fromAgentId,
			workKind: 'direct',
			workId: normalized.requestId,
			outcome: 'completed',
		});
	};

	handleDirectCancel = async (
		context: IConnectionContext,
		parsed: IDirectCancelPayload,
	) => {
		if (
			context.meta.connectionRole === 'worker' &&
			context.meta.agentId !== parsed.fromAgentId
		) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'Worker mismatch for direct:cancel',
				{ requestId: parsed.requestId, fromAgentId: parsed.fromAgentId },
			);
			return;
		}

		const entry = this.options.inbox.findByRequestId(
			parsed.toAgentId,
			parsed.requestId,
		);
		if (!entry) {
			return;
		}

		if (entry.status === 'queued') {
			this.options.inbox.transition(entry.entryId, 'dropped');
			this.options.restoreRequesterWorkState(
				parsed.fromAgentId,
				parsed.requestId,
				parsed.sourceTaskId,
			);
			return;
		}

		if (entry.status === 'reserved') {
			this.options.inbox.transition(entry.entryId, 'dropped');
			this.options.restoreRequesterWorkState(
				parsed.fromAgentId,
				parsed.requestId,
				parsed.sourceTaskId,
			);
			return;
		}

		if (entry.status === 'dispatched') {
			const targetConnectionId = this.options.mailbox.resolve(parsed.toAgentId);
			if (targetConnectionId) {
				await this.options.sendToConnection(targetConnectionId, {
					type: DIRECT_CANCEL,
					channel: `direct:${parsed.requestId}`,
					payload: parsed,
				});
			}
			this.options.inbox.transition(entry.entryId, 'dropped');
			this.options.restoreRequesterWorkState(
				parsed.fromAgentId,
				parsed.requestId,
				parsed.sourceTaskId,
			);
		}
	};

	private normalizeWorkerDirectResponse = (payload: IDirectResponsePayload) => {
		if (payload.action === 'ACK') {
			return {
				...payload,
				origin: payload.origin ?? 'worker',
				ackKind: payload.ackKind ?? 'peer_rejected',
				reasonCode: payload.reasonCode ?? 'rejected',
			} satisfies IDirectResponsePayload;
		}
		return {
			...payload,
			origin: payload.origin ?? 'worker',
		} satisfies IDirectResponsePayload;
	};
}
