import {
	type IMessageListPayload,
	type IMessageListResultPayload,
	type IMessagePostPayload,
	type IMessagePostResultPayload,
	MESSAGE_LIST_RESULT,
	MESSAGE_POST_RESULT,
} from '@agent-group-lab/contracts/messages';
import type {
	IProtocolEnvelope,
	IProtocolErrorPayload,
} from '@agent-group-lab/protocol';
import type { IRoomMessage } from '~/domain/room-message';
import type { IHostStore } from '~/store/store';
import type { IConnectionContext } from '../infra/connection-manager';

interface IRoomMessageHandlerOptions {
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

export class RoomMessageHandler {
	private readonly options: IRoomMessageHandlerOptions;

	constructor(options: IRoomMessageHandlerOptions) {
		this.options = options;
	}

	handleMessagePost = async (
		context: IConnectionContext,
		payload: IMessagePostPayload,
	) => {
		if (!payload.toAgentId) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'message:post requires toAgentId in v1',
			);
			return;
		}

		const existing = this.options.store.getRoomMessage(payload.messageId);
		if (existing) {
			await this.sendMessagePostResult(context.meta.connectionId, existing);
			return;
		}

		const sender = this.options.store.getMember(payload.fromAgentId);
		if (!sender) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				`Unknown sender agentId: ${payload.fromAgentId}`,
			);
			return;
		}

		const target = this.options.store.getMember(payload.toAgentId);
		if (!target) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				`Unknown target agentId: ${payload.toAgentId}`,
			);
			return;
		}

		const createdAt = Date.now();
		const message: IRoomMessage = {
			messageId: payload.messageId,
			fromAgentId: payload.fromAgentId,
			fromAgentName: payload.fromAgentName,
			toAgentId: target.agentId,
			toAgentName: target.agentName,
			content: payload.content,
			createdAt,
			expiresAt:
				payload.ttlMs === undefined ? undefined : createdAt + payload.ttlMs,
		};
		this.options.store.addRoomMessage(message);

		await this.sendMessagePostResult(context.meta.connectionId, message);
	};

	handleMessageList = async (
		context: IConnectionContext,
		payload: IMessageListPayload,
	) => {
		const limit = payload.limit ?? 50;
		const results = this.options.store.listRoomMessages({
			toAgentId: payload.scope === 'broadcast' ? undefined : payload.toAgentId,
			includeBroadcast: payload.scope !== 'direct',
			after: payload.after,
			limit,
		});

		const hasNext = results.length > limit;
		const messages = hasNext ? results.slice(0, limit) : results;
		const lastMessage = messages.at(-1);
		const response: IMessageListResultPayload = {
			messages,
			nextCursor:
				hasNext && lastMessage
					? {
							createdAt: lastMessage.createdAt,
							messageId: lastMessage.messageId,
						}
					: undefined,
		};

		await this.options.sendToConnection(context.meta.connectionId, {
			type: MESSAGE_LIST_RESULT,
			channel: 'control',
			payload: response,
		});
	};

	private sendMessagePostResult = async (
		connectionId: string,
		message: IRoomMessage,
	) => {
		const response: IMessagePostResultPayload = {
			messageId: message.messageId,
			createdAt: message.createdAt,
			expiresAt: message.expiresAt,
		};

		await this.options.sendToConnection(connectionId, {
			type: MESSAGE_POST_RESULT,
			channel: 'control',
			payload: response,
		});
	};
}
