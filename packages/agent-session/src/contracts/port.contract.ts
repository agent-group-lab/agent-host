import type { IWorkerLifecycleEvent } from '@agent-group-lab/agent-host-runtime-node/worker/websocket';
import type {
	AgentEvent,
	IConversationRef,
} from '@agent-group-lab/contracts/agent';
import type { IAgentEventPayload } from '@agent-group-lab/contracts/messages';
import type { ISessionAgent } from './agent.contract';
import type { ISessionWorkerMode } from './status.contract';

export interface IWorkerRunLocalResult {
	status: 'delivered' | 'failed' | 'busy';
	content?: string;
	reason?: string;
	activeTaskId?: string;
}

export interface ICreateWorkerInput<TAgent extends ISessionAgent> {
	agent: TAgent;
	mode: ISessionWorkerMode;
	conversationRef?: IConversationRef;
	onEvent: (payload: IAgentEventPayload) => void;
	onLog: (message: string) => void;
}

export interface ISessionWorkerHandle {
	start(): Promise<unknown>;
	close(): Promise<unknown>;
	cancelRunLocal(): void;
	runLocal(input: {
		prompt: string;
		workingDirectory?: string;
		onEvent?: (event: AgentEvent) => void;
	}): Promise<IWorkerRunLocalResult>;
	onLifecycleEvent(
		listener: (event: IWorkerLifecycleEvent) => void,
	): () => void;
}

export interface ISessionPort<TAgent extends ISessionAgent> {
	createWorker(
		input: ICreateWorkerInput<TAgent>,
	): Promise<ISessionWorkerHandle>;
}
