import { z } from 'zod';

import { nonNegativeIntegerSchema } from '~/shared/schemas';

export const TASK_PUBLISH_BATCH = 'task:publish-batch' as const;

export const taskPlanNodePayloadSchema = z.object({
	taskId: z.string(),
	turnId: z.string(),
	prompt: z.string(),
	workingDirectory: z.string().optional(),
	parentTaskId: z.string().optional(),
	dependencies: z.array(z.string()).optional(),
	deliverableSpec: z.string().optional(),
	slaDeadline: nonNegativeIntegerSchema.optional(),
	dispatchMode: z.enum(['push', 'claim']).optional(),
	requestedAgentId: z.string().optional(),
	suggestedAgentIds: z.array(z.string()).optional(),
	suggestionPolicy: z.enum(['strict', 'preferred']).optional(),
});

export const taskPublishBatchPayloadSchema = z.object({
	planId: z.string(),
	nodes: z.array(taskPlanNodePayloadSchema),
	atomic: z.boolean().optional(),
});

export type ITaskPlanNodePayload = z.infer<typeof taskPlanNodePayloadSchema>;
export type ITaskPublishBatchPayload = z.infer<
	typeof taskPublishBatchPayloadSchema
>;
