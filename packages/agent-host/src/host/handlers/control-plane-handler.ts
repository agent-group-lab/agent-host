import {
	createProtocolError,
	type IProtocolEnvelope,
} from '@agent-group-lab/protocol';
import type { IConnectionMeta } from '~/store/store';
import type { IConnectionContext } from '../infra/connection-manager';
import type { IMessageGateway } from '../infra/message-gateway';

interface IControlPlaneHandlerOptions {
	messageGateway: IMessageGateway;
	updateConnectionMeta: (
		connectionId: string,
		updates: Partial<IConnectionMeta>,
	) => void;
	log: (message: string) => void;
}

export class ControlPlaneHandler {
	private readonly options: IControlPlaneHandlerOptions;

	constructor(options: IControlPlaneHandlerOptions) {
		this.options = options;
	}

	handleControlMessage = async (
		context: IConnectionContext,
		message: IProtocolEnvelope<string, unknown>,
	) => {
		try {
			if (message.type === 'control:hello') {
				context.live.control.apply('control:hello');
				await context.live.connection.send(
					this.options.messageGateway.createEnvelope({
						type: 'control:ready',
						channel: 'control',
						payload: {
							connectionId: context.live.connection.id,
						},
					}),
				);
				context.live.control.apply('control:ready');
				this.options.updateConnectionMeta(context.meta.connectionId, {
					ready: true,
				});
				return;
			}

			if (message.type === 'control:heartbeat') {
				context.live.control.apply('control:heartbeat');
				await context.live.connection.send(
					this.options.messageGateway.createEnvelope({
						type: 'control:ack',
						channel: 'control',
						payload: {
							ackSeq: message.seq,
						},
					}),
				);
				return;
			}
		} catch (error) {
			const protocolError =
				error instanceof Error
					? createProtocolError({
							code: 'protocol',
							message: error.message,
							details: { type: message.type },
						})
					: createProtocolError({
							code: 'protocol',
							message: 'Unknown control message error',
							details: { type: message.type },
						});
			await this.options.messageGateway.sendErrorPayload(
				context.live.connection,
				protocolError,
			);
			return;
		}

		if (message.type === 'control:error') {
			this.options.log(
				`Remote control:error from ${context.live.connection.id}`,
			);
		}
	};
}
