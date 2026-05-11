import { z } from 'zod';
import type { AgentEvent } from './models.schema';

export type { AgentEvent, IAgentEventEnvelope } from './models.schema';

export const capabilitiesSchema = z.object({
	streaming: z.boolean(),
	toolUse: z.boolean(),
	codeExecution: z.boolean(),
	fileRead: z.boolean(),
	fileWrite: z.boolean(),
});

export type ICapabilities = z.infer<typeof capabilitiesSchema>;

export interface IToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	handler: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface IConversationRef {
	id: string;
}

export interface IProviderAdapterOptions {
	conversationRef?: IConversationRef;
}

export interface IRunTurnRequest {
	taskId: string;
	turnId: string;
	prompt: string;
	workingDirectory?: string;
	tools?: IToolDefinition[];
	systemPromptSuffix?: string;
}

export interface IProviderAdapter {
	readonly id: string;
	readonly displayName: string;
	capabilities: () => Promise<ICapabilities>;
	runTurn: (request: IRunTurnRequest) => AsyncIterable<AgentEvent>;
	abort?: () => void;
}

export type CreateEventInput = {
	[K in AgentEvent['type']]: Omit<
		Extract<AgentEvent, { type: K }>,
		'id' | 'ts'
	>;
}[AgentEvent['type']];
