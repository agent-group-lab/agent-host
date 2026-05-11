import type { IWorkerRegistry } from '~/store/store';

export interface IMailbox {
	resolve: (agentId: string) => string | undefined;
	isOnline: (agentId: string) => boolean;
}

export class StoreBackedMailbox implements IMailbox {
	constructor(private readonly store: IWorkerRegistry) {}

	resolve = (agentId: string) => {
		const worker = this.store.getWorker(agentId);
		if (!worker || worker.workState.kind === 'offline') {
			return undefined;
		}
		return worker.connectionId;
	};

	isOnline = (agentId: string) => {
		const worker = this.store.getWorker(agentId);
		return !!worker && worker.workState.kind !== 'offline';
	};
}
