import type {
	AgentRole,
	IHostWorkerRecord,
} from '@agent-group-lab/contracts/messages';

export interface ISelectWorkerInput {
	workers: IHostWorkerRecord[];
	requestedAgentId?: string;
	requiredRole?: AgentRole;
}

export interface ISelectWorkerResult {
	worker?: IHostWorkerRecord;
	error?: string;
}

const isWorkerSelectable = (worker: IHostWorkerRecord) => {
	return worker.workState.kind === 'idle';
};

export const selectWorkerForTask = (input: ISelectWorkerInput) => {
	const candidates = input.requiredRole
		? input.workers.filter((worker) => worker.agentRole === input.requiredRole)
		: input.workers;

	if (input.requestedAgentId) {
		const requested = input.workers.find(
			(worker) => worker.agentId === input.requestedAgentId,
		);
		if (!requested) {
			return {
				error: `Worker "${input.requestedAgentId}" not found`,
			} satisfies ISelectWorkerResult;
		}
		if (input.requiredRole && requested.agentRole !== input.requiredRole) {
			return {
				error: `Worker "${input.requestedAgentId}" is not role "${input.requiredRole}"`,
			} satisfies ISelectWorkerResult;
		}

		if (!isWorkerSelectable(requested)) {
			return {
				error: `Worker "${input.requestedAgentId}" is not idle`,
			} satisfies ISelectWorkerResult;
		}

		return {
			worker: requested,
		} satisfies ISelectWorkerResult;
	}

	const firstIdleWorker = candidates.find((worker) =>
		isWorkerSelectable(worker),
	);
	if (!firstIdleWorker) {
		if (input.requiredRole) {
			return {
				error: `No idle "${input.requiredRole}" worker is available`,
			} satisfies ISelectWorkerResult;
		}
		return {
			error: 'No idle worker is available',
		} satisfies ISelectWorkerResult;
	}

	return {
		worker: firstIdleWorker,
	} satisfies ISelectWorkerResult;
};
