import {
	createWorkerServiceCore,
	type ICreateWorkerServiceOptions,
} from '~/worker/shared/create-worker-service-core';
import { createWorkerWithUds } from './create-worker-with-uds';

export const createWorkerService = (options: ICreateWorkerServiceOptions) => {
	return createWorkerServiceCore(options, (core) => {
		return createWorkerWithUds({
			socketPath: core.endpoint,
			adapter: core.adapter,
			agentId: core.agentId,
			agentName: core.agentName,
			workerRole: core.role,
			workerProfile: core.workerProfile,
			onLog: core.onLog,
			onEvent: core.onEvent,
			enableTaskClaim: core.enableTaskClaim,
			claimLeaseMs: core.claimLeaseMs,
			claimBackoffBaseMs: core.claimBackoffBaseMs,
			claimBackoffMaxMs: core.claimBackoffMaxMs,
		});
	});
};
