import type { IClientPort } from '~/ports/client-port';
import { WebSocketClient } from '~/transport/websocket/websocket-client';

export interface ICreateWebSocketClientPortOptions {
	wsUrl: string;
}

export const createWebSocketClientPort = (
	options: ICreateWebSocketClientPortOptions,
): IClientPort => {
	return new WebSocketClient({
		wsUrl: options.wsUrl,
	});
};
