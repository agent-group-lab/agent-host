import {
	createWorkerServiceCore,
	type ICreateWorkerServiceOptions,
} from '~/worker/shared/create-worker-service-core';
import { createWorkerWithWebSocket } from './create-worker-with-websocket';

export const createWorkerService = (options: ICreateWorkerServiceOptions) => {
	return createWorkerServiceCore(options, (core) => {
		return createWorkerWithWebSocket({
			wsUrl: core.endpoint,
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
