import { z } from 'zod';

export const TASK_CLAIM_RESULT = 'task:claim:result' as const;

export const taskClaimResultPayloadSchema = z.object({
	requestId: z.string(),
	status: z.enum(['claimed', 'none', 'rejected']),
	taskId: z.string().optional(),
	assignmentToken: z.string().optional(),
	leaseExpiresAt: z.number().int().nonnegative().optional(),
	reasonCode: z
		.enum([
			'no_matching_claimable_task',
			'task_not_found',
			'task_not_claimable',
			'worker_not_idle',
			'suggested_agent_mismatch',
			'preferred_window_active',
			'unauthorized',
			'invalid_request',
			'dispatch_failed',
		])
		.optional(),
	reason: z.string().optional(),
});

export type ITaskClaimResultPayload = z.infer<
	typeof taskClaimResultPayloadSchema
>;
