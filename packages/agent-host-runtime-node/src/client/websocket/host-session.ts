import {
	createHostSession,
	type ICreateHostSessionOptions,
	type IHostSession,
} from '~/client/shared/host-session-core';
import { createWebSocketClientPort } from './create-websocket-client-port';

export const createWebSocketHostSession = async (
	wsUrl: string,
	options?: ICreateHostSessionOptions,
): Promise<IHostSession> => {
	const clientPort = createWebSocketClientPort({ wsUrl });
	return await createHostSession(clientPort, options);
};

export type { IHostSession };
