import { WorkerCore } from '@agent-group-lab/agent-host/worker';
import type { IProviderAdapter } from '@agent-group-lab/contracts/agent';
import type {
	AgentRole,
	IAgentEventPayload,
	IWorkerProfile,
} from '@agent-group-lab/contracts/messages';
import { UdsClient } from '~/transport/uds/uds-client';

export interface ICreateWorkerWithUdsOptions {
	socketPath: string;
	adapter: IProviderAdapter;
	agentId?: string;
	agentName?: string;
	workerRole?: AgentRole;
	workerProfile?: IWorkerProfile;
	onLog?: (message: string) => void;
	onEvent?: (payload: IAgentEventPayload) => void;
	enableTaskClaim?: boolean;
	claimLeaseMs?: number;
	claimBackoffBaseMs?: number;
	claimBackoffMaxMs?: number;
}

export const createWorkerWithUds = (options: ICreateWorkerWithUdsOptions) => {
	const clientPort = new UdsClient({
		socketPath: options.socketPath,
	});
	return new WorkerCore(
		{
			agentId: options.agentId,
			agentName: options.agentName,
			workerRole: options.workerRole,
			workerProfile: options.workerProfile,
			onLog: options.onLog,
			onEvent: options.onEvent,
			enableTaskClaim: options.enableTaskClaim,
			claimLeaseMs: options.claimLeaseMs,
			claimBackoffBaseMs: options.claimBackoffBaseMs,
			claimBackoffMaxMs: options.claimBackoffMaxMs,
		},
		options.adapter,
		clientPort,
	);
};
