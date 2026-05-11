import {
	createHostSession,
	type ICreateHostSessionOptions,
	type IHostSession,
} from '~/client/shared/host-session-core';
import { createUdsClientPort } from './create-uds-client-port';

export const createUdsHostSession = async (
	socketPath: string,
	options?: ICreateHostSessionOptions,
): Promise<IHostSession> => {
	const clientPort = createUdsClientPort({ socketPath });
	return await createHostSession(clientPort, options);
};

export type { IHostSession };
