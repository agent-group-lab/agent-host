import { z } from 'zod';

export const TASK_DELIVER = 'task:deliver' as const;

export const taskDeliverPayloadSchema = z.object({
	requestId: z.string(),
	taskId: z.string(),
	assignmentToken: z.string(),
	artifact: z.unknown().optional(),
});

export type ITaskDeliverPayload = z.infer<typeof taskDeliverPayloadSchema>;
