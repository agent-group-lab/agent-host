import { createWorkerService } from '@agent-group-lab/agent-host-runtime-node/worker/websocket';
import type { AgentRole } from '@agent-group-lab/contracts/messages';
import type { ISessionAgent } from '~/contracts/agent.contract';
import type {
	ICreateWorkerInput,
	ISessionPort,
	ISessionWorkerHandle,
} from '~/contracts/port.contract';

export class WebSocketSessionPort<TAgent extends ISessionAgent>
	implements ISessionPort<TAgent>
{
	constructor(private readonly _wsUrl: string) {}

	createWorker = async (
		input: ICreateWorkerInput<TAgent>,
	): Promise<ISessionWorkerHandle> => {
		const { agent, mode, conversationRef, onEvent, onLog } = input;
		const worker = createWorkerService({
			endpoint: this._wsUrl,
			adapterId: agent.adapterId,
			agentId: agent.id,
			agentName: agent.name,
			role: mode as AgentRole,
			conversationRef,
			workerProfile: agent.description
				? { profile: agent.description }
				: undefined,
			enableTaskClaim: mode === 'executor',
			onLog,
			onEvent,
		});
		return Promise.resolve(worker as unknown as ISessionWorkerHandle);
	};
}
