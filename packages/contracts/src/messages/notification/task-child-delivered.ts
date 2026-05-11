import { z } from 'zod';

export const TASK_CHILD_DELIVERED = 'task:child-delivered' as const;

export const taskChildDeliveredPayloadSchema = z.object({
	parentTaskId: z.string(),
	childTaskId: z.string(),
	childAssigneeId: z.string(),
	childAssigneeName: z.string(),
	artifact: z.unknown().optional(),
	remainingChildren: z.number().int().nonnegative(),
	allChildrenDone: z.boolean(),
});

export type ITaskChildDeliveredPayload = z.infer<
	typeof taskChildDeliveredPayloadSchema
>;
