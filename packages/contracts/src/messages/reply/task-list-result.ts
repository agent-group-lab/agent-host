import { z } from 'zod';

export const TASK_LIST_RESULT = 'task:list:result' as const;

export const taskListItemSchema = z.object({
	taskId: z.string(),
	status: z.enum(['todo', 'assigned', 'doing', 'blocked', 'done', 'cancelled']),
	parentTaskId: z.string().optional(),
	assigneeId: z.string().optional(),
	assigneeName: z.string().optional(),
	completedAt: z.number().int().nonnegative().optional(),
	failureMessage: z.string().optional(),
	artifact: z.unknown().optional(),
});

export const taskListResultPayloadSchema = z.object({
	requestId: z.string(),
	tasks: z.array(taskListItemSchema),
	missingTaskIds: z.array(z.string()),
});

export type ITaskListItem = z.infer<typeof taskListItemSchema>;
export type ITaskListResultPayload = z.infer<
	typeof taskListResultPayloadSchema
>;
