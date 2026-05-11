import { z } from 'zod';

export const TASK_PUBLISH_BATCH_RESULT = 'task:publish-batch:result' as const;

export const taskPublishBatchResultPayloadSchema = z.object({
	planId: z.string(),
	status: z.enum(['accepted', 'rejected']),
	acceptedTaskIds: z.array(z.string()),
	rejected: z
		.array(
			z.object({
				taskId: z.string().optional(),
				reasonCode: z.string(),
				reason: z.string(),
			}),
		)
		.optional(),
});

export type ITaskPublishBatchResultPayload = z.infer<
	typeof taskPublishBatchResultPayloadSchema
>;
