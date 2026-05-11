import { z } from 'zod';

import { nonNegativeIntegerSchema } from '~/shared/schemas';

export const TASK_CLAIM_PULL = 'task:claim:pull' as const;

export const taskClaimPullPayloadSchema = z.object({
	requestId: z.string(),
	taskId: z.string(),
	claimLeaseMs: nonNegativeIntegerSchema.optional(),
	executionLeaseMs: nonNegativeIntegerSchema.optional(),
});

export type ITaskClaimPullPayload = z.infer<typeof taskClaimPullPayloadSchema>;
