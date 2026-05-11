import { WorkerCore } from '@agent-group-lab/agent-host/worker';
import type { IProviderAdapter } from '@agent-group-lab/contracts/agent';
import type {
	AgentRole,
	IAgentEventPayload,
	IWorkerProfile,
} from '@agent-group-lab/contracts/messages';
import { WebSocketClient } from '~/transport/websocket/websocket-client';

export interface ICreateWorkerWithWebSocketOptions {
	wsUrl: string;
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

export const createWorkerWithWebSocket = (
	options: ICreateWorkerWithWebSocketOptions,
) => {
	const clientPort = new WebSocketClient({
		wsUrl: options.wsUrl,
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
