import { z } from 'zod';

import { nonNegativeIntegerSchema } from '~/shared/schemas';

export const TASK_ASSIGN = 'task:assign' as const;

export const taskAssignPayloadSchema = z.object({
	taskId: z.string(),
	turnId: z.string(),
	prompt: z.string(),
	workingDirectory: z.string().optional(),
	agentId: z.string().optional(),
	agentName: z.string().optional(),
	parentTaskId: z.string().optional(),
	dependencies: z.array(z.string()).optional(),
	deliverableSpec: z.string().optional(),
	slaDeadline: nonNegativeIntegerSchema.optional(),
	assignmentToken: z.string().optional(),
	dispatchMode: z.enum(['push', 'claim']).optional(),
});

export type ITaskAssignPayload = z.infer<typeof taskAssignPayloadSchema>;
