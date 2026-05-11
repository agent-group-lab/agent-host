import type { IClientPort } from '~/ports/client-port';
import { UdsClient } from '~/transport/uds/uds-client';

export interface ICreateUdsClientPortOptions {
	socketPath: string;
}

export const createUdsClientPort = (
	options: ICreateUdsClientPortOptions,
): IClientPort => {
	return new UdsClient({
		socketPath: options.socketPath,
	});
};
