import { z } from 'zod';

export const workStateSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('offline') }),
	z.object({ kind: z.literal('idle') }),
	z.object({ kind: z.literal('focused'), taskId: z.string() }),
	z.object({
		kind: z.literal('waiting_tool'),
		taskId: z.string(),
		toolName: z.string().optional(),
	}),
	z.object({
		kind: z.literal('waiting_delegation'),
		taskId: z.string(),
		toolName: z.string().optional(),
	}),
	z.object({
		kind: z.literal('waiting_peer'),
		taskId: z.string(),
		requestId: z.string(),
		toAgentId: z.string(),
	}),
	z.object({
		kind: z.literal('blocked'),
		taskId: z.string(),
		reason: z.string(),
	}),
	z.object({ kind: z.literal('finished'), taskId: z.string() }),
]);

export type WorkState = z.infer<typeof workStateSchema>;
export type WorkStateKind = WorkState['kind'];
