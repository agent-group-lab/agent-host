import { z } from 'zod';

export const TASK_CHILDREN_COMPLETED = 'task:children-completed' as const;

export const taskChildrenCompletedPayloadSchema = z.object({
	parentTaskId: z.string(),
	parentAssigneeId: z.string(),
	parentAssigneeName: z.string(),
	childTaskIds: z.array(z.string()),
});

export type ITaskChildrenCompletedPayload = z.infer<
	typeof taskChildrenCompletedPayloadSchema
>;
