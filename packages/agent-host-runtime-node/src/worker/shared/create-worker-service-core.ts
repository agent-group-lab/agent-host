import type { WorkerCore } from '@agent-group-lab/agent-host/worker';
import type { IProviderAdapterOptions } from '@agent-group-lab/contracts/agent';
import type {
	AgentRole,
	IAgentEventPayload,
	IWorkerProfile,
} from '@agent-group-lab/contracts/messages';
import { createProviderAdapter } from '~/provider/create-provider-adapter';

export interface ICreateWorkerServiceOptions extends IProviderAdapterOptions {
	endpoint: string;
	adapterId: string;
	agentId?: string;
	agentName?: string;
	role?: AgentRole;
	workerProfile?: IWorkerProfile;
	onLog?: (message: string) => void;
	onEvent?: (payload: IAgentEventPayload) => void;
	enableTaskClaim?: boolean;
	claimLeaseMs?: number;
	claimBackoffBaseMs?: number;
	claimBackoffMaxMs?: number;
}

export const createWorkerServiceCore = (
	options: ICreateWorkerServiceOptions,
	createWorkerRuntime: (
		options: ICreateWorkerServiceOptions & {
			adapter: NonNullable<ReturnType<typeof createProviderAdapter>>;
		},
	) => WorkerCore,
) => {
	const adapter = createProviderAdapter(options.adapterId, {
		conversationRef: options.conversationRef,
	});
	if (!adapter) {
		throw new Error(`Unsupported adapter: ${options.adapterId}`);
	}

	return createWorkerRuntime({
		endpoint: options.endpoint,
		adapterId: options.adapterId,
		adapter,
		conversationRef: options.conversationRef,
		agentId: options.agentId,
		agentName: options.agentName,
		role: options.role,
		workerProfile: options.workerProfile,
		onLog: options.onLog,
		onEvent: options.onEvent,
		enableTaskClaim: options.enableTaskClaim,
		claimLeaseMs: options.claimLeaseMs,
		claimBackoffBaseMs: options.claimBackoffBaseMs,
		claimBackoffMaxMs: options.claimBackoffMaxMs,
	});
};
