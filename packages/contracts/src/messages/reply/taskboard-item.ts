import { z } from 'zod';

export const taskboardCursorSchema = z.object({
	createdAt: z.number().int().nonnegative(),
	taskId: z.string().min(1),
});

export const taskboardListItemSchema = z.object({
	taskId: z.string().min(1),
	turnId: z.string().min(1),
	prompt: z.string(),
	status: z.enum(['todo', 'assigned', 'doing', 'blocked', 'done', 'cancelled']),
	workingDirectory: z.string().optional(),
	parentTaskId: z.string().optional(),
	dependencies: z.array(z.string()),
	assigneeId: z.string().optional(),
	assigneeName: z.string().optional(),
	deliverableSpec: z.string().optional(),
	dispatchMode: z.enum(['push', 'claim']).optional(),
	suggestedAgentIds: z.array(z.string()).optional(),
	suggestionPolicy: z.enum(['strict', 'preferred']).optional(),
	createdAt: z.number().int().nonnegative(),
	completedAt: z.number().int().nonnegative().optional(),
	failureMessage: z.string().optional(),
	claimLeaseExpiresAt: z.number().int().nonnegative().optional(),
	claimedAt: z.number().int().nonnegative().optional(),
	artifact: z.unknown().optional(),
});

export type ITaskboardCursor = z.infer<typeof taskboardCursorSchema>;
export type ITaskboardListItem = z.infer<typeof taskboardListItemSchema>;
