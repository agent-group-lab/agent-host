import { z } from 'zod';

export const TASK_COMPLETED = 'task:completed' as const;

export const taskCompletedPayloadSchema = z.object({
	taskId: z.string(),
	agentId: z.string(),
	agentName: z.string(),
	artifact: z.unknown().optional(),
});

export type ITaskCompletedPayload = z.infer<typeof taskCompletedPayloadSchema>;
