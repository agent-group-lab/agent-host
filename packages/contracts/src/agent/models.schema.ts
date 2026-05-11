import { z } from 'zod';

const agentEventBaseSchema = z.object({
	id: z.string(),
	ts: z.number(),
	turnId: z.string(),
	taskId: z.string(),
	adapterId: z.string(),
});

const turnStartEventSchema = agentEventBaseSchema.extend({
	type: z.literal('turn:start'),
});

const turnEndEventSchema = agentEventBaseSchema.extend({
	type: z.literal('turn:end'),
});

const textDeltaEventSchema = agentEventBaseSchema.extend({
	type: z.literal('text:delta'),
	content: z.string(),
});

const textDoneEventSchema = agentEventBaseSchema.extend({
	type: z.literal('text:done'),
	content: z.string(),
});

const toolStartEventSchema = agentEventBaseSchema.extend({
	type: z.literal('tool:start'),
	toolName: z.string(),
	args: z.record(z.string(), z.unknown()),
	targetAgentIds: z.array(z.string()).optional(),
	relatedTaskIds: z.array(z.string()).optional(),
});

const toolDoneEventSchema = agentEventBaseSchema.extend({
	type: z.literal('tool:done'),
	toolName: z.string(),
	output: z.string(),
	isError: z.boolean(),
	args: z.record(z.string(), z.unknown()).optional(),
	targetAgentIds: z.array(z.string()).optional(),
	relatedTaskIds: z.array(z.string()).optional(),
});

const fileChangeEventSchema = agentEventBaseSchema.extend({
	type: z.literal('file:change'),
	filePath: z.string(),
	operation: z.enum(['add', 'update', 'delete']),
});

const errorEventSchema = agentEventBaseSchema.extend({
	type: z.literal('error'),
	message: z.string(),
	fatal: z.boolean(),
});

const conversationReadyEventSchema = agentEventBaseSchema.extend({
	type: z.literal('conversation:ready'),
	conversationId: z.string(),
});

export const agentEventSchema = z.discriminatedUnion('type', [
	turnStartEventSchema,
	turnEndEventSchema,
	textDeltaEventSchema,
	textDoneEventSchema,
	toolStartEventSchema,
	toolDoneEventSchema,
	fileChangeEventSchema,
	errorEventSchema,
	conversationReadyEventSchema,
]);

export const agentEventEnvelopeSchema = z.object({
	taskId: z.string(),
	agentId: z.string(),
	agentName: z.string(),
	event: agentEventSchema,
});

export type AgentEvent = z.infer<typeof agentEventSchema>;
export type IAgentEventEnvelope = z.infer<typeof agentEventEnvelopeSchema>;
