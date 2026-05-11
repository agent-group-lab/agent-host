import { z } from 'zod';

export const TASK_CHILDREN_STATUS_RESULT =
	'task:children:status:result' as const;

export const taskChildrenStatusItemSchema = z.object({
	taskId: z.string(),
	parentTaskId: z.string().optional(),
	depth: z.number().int().nonnegative(),
	status: z.enum(['todo', 'assigned', 'doing', 'blocked', 'done', 'cancelled']),
	dependencies: z.array(z.string()),
	assigneeId: z.string().optional(),
	assigneeName: z.string().optional(),
	completedAt: z.number().int().nonnegative().optional(),
	failureMessage: z.string().optional(),
	artifact: z.unknown().optional(),
});

export const taskChildrenStatusResultPayloadSchema = z.object({
	requestId: z.string(),
	parentTaskId: z.string(),
	recursive: z.boolean(),
	summary: z.object({
		total: z.number().int().nonnegative(),
		done: z.number().int().nonnegative(),
		cancelled: z.number().int().nonnegative(),
		inProgress: z.number().int().nonnegative(),
		todo: z.number().int().nonnegative(),
		blocked: z.number().int().nonnegative(),
	}),
	allChildrenTerminal: z.boolean(),
	allChildrenDone: z.boolean(),
	children: z.array(taskChildrenStatusItemSchema),
});

export type ITaskChildrenStatusItem = z.infer<
	typeof taskChildrenStatusItemSchema
>;
export type ITaskChildrenStatusResultPayload = z.infer<
	typeof taskChildrenStatusResultPayloadSchema
>;
