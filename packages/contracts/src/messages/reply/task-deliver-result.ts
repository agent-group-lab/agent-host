import { z } from 'zod';

export const TASK_DELIVER_RESULT = 'task:deliver:result' as const;

export const taskDeliverResultPayloadSchema = z.object({
	requestId: z.string(),
	status: z.enum(['delivered', 'conflict', 'rejected']),
	reason: z.string().optional(),
});

export type ITaskDeliverResultPayload = z.infer<
	typeof taskDeliverResultPayloadSchema
>;
