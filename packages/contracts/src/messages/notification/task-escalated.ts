import { z } from 'zod';

export const TASK_ESCALATED = 'task:escalated' as const;

export const taskEscalatedPayloadSchema = z.object({
	taskId: z.string(),
	agentId: z.string(),
	agentName: z.string(),
	decisionNeeded: z.string(),
});

export type ITaskEscalatedPayload = z.infer<typeof taskEscalatedPayloadSchema>;
