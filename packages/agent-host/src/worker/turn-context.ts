import type { IToolDefinition } from '@agent-group-lab/contracts/agent';

export interface ITurnContext {
	tools: IToolDefinition[];
}
