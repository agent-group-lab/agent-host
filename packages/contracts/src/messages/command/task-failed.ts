import { z } from 'zod';

export const TASK_FAILED = 'task:failed' as const;

export const taskFailedPayloadSchema = z.object({
	taskId: z.string(),
	agentId: z.string(),
	agentName: z.string(),
	message: z.string(),
});

export type ITaskFailedPayload = z.infer<typeof taskFailedPayloadSchema>;
