import {
	type IInboxListPayload,
	type IInboxListResultPayload,
	INBOX_LIST_RESULT,
} from '@agent-group-lab/contracts/messages';
import type {
	IProtocolEnvelope,
	IProtocolErrorPayload,
} from '@agent-group-lab/protocol';
import type { IHostStore } from '~/store/store';
import type { IConnectionContext } from '../infra/connection-manager';

interface IInboxListHandlerOptions {
	store: IHostStore;
	sendProtocolError: (
		connection: IConnectionContext['live']['connection'],
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
}

export class InboxListHandler {
	private readonly options: IInboxListHandlerOptions;

	constructor(options: IInboxListHandlerOptions) {
		this.options = options;
	}

	handleInboxList = async (
		context: IConnectionContext,
		parsed: IInboxListPayload,
	) => {
		if (!parsed.targetAgentId.trim()) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'inbox:list requires targetAgentId',
			);
			return;
		}

		const entries = this.options.store.listInboxEntries({
			toAgentId: parsed.targetAgentId,
			status: parsed.status,
		});
		const result: IInboxListResultPayload = {
			targetAgentId: parsed.targetAgentId,
			entries: entries.map((entry) => {
				const worker = this.options.store.getWorker(entry.toAgentId);
				return {
					entryId: entry.entryId,
					toAgentId: entry.toAgentId,
					toAgentName: entry.toAgentName,
					fromAgentId: entry.fromAgentId,
					fromAgentName: entry.fromAgentName,
					requestId: entry.requestId,
					status: entry.status,
					work: entry.work,
					payload: entry.payload,
					createdAt: entry.createdAt,
					updatedAt: entry.updatedAt,
					online: worker !== undefined && worker.workState.kind !== 'offline',
					workState: worker?.workState ?? null,
				};
			}),
		};

		await this.options.sendToConnection(context.meta.connectionId, {
			type: INBOX_LIST_RESULT,
			channel: 'control',
			payload: result,
		});
	};
}
