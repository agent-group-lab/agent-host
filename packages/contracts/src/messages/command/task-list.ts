import { z } from 'zod';

export const TASK_LIST = 'task:list' as const;

export const taskListPayloadSchema = z.object({
	requestId: z.string(),
	taskIds: z.array(z.string()).min(1),
	includeArtifacts: z.boolean().optional(),
});

export type ITaskListPayload = z.infer<typeof taskListPayloadSchema>;
