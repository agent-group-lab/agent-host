import { z } from 'zod';

import { nonNegativeIntegerSchema } from '~/shared/schemas';

export const TASK_CLAIM = 'task:claim' as const;

export const taskClaimPayloadSchema = z.object({
	requestId: z.string(),
	selector: z
		.object({
			taskId: z.string().optional(),
			parentTaskId: z.string().optional(),
		})
		.optional(),
	claimLeaseMs: nonNegativeIntegerSchema.optional(),
	executionLeaseMs: nonNegativeIntegerSchema.optional(),
});

export type ITaskClaimPayload = z.infer<typeof taskClaimPayloadSchema>;
