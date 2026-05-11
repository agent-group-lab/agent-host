import { z } from 'zod';

export const TASK_ACCEPTED = 'task:accepted' as const;

export const taskAcceptedPayloadSchema = z.object({
	taskId: z.string(),
	agentId: z.string(),
	agentName: z.string(),
});

export type ITaskAcceptedPayload = z.infer<typeof taskAcceptedPayloadSchema>;
