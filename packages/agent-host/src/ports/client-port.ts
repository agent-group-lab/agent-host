import type { IWorkerClientPort } from './worker-client-port';

export type IClientPort = Pick<
	IWorkerClientPort,
	'connect' | 'send' | 'subscribe' | 'waitForMessage' | 'close'
>;
