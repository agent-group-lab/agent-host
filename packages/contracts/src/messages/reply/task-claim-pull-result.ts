import { z } from 'zod';

export const TASK_CLAIM_PULL_RESULT = 'task:claim:pull:result' as const;

export const taskClaimPullTaskSchema = z.object({
	taskId: z.string(),
	turnId: z.string(),
	prompt: z.string(),
	parentTaskId: z.string().optional(),
	dependencies: z.array(z.string()),
	requesterAgentId: z.string().optional(),
});

export const taskClaimPullResultPayloadSchema = z.object({
	requestId: z.string(),
	status: z.enum(['claimed', 'rejected']),
	taskId: z.string().optional(),
	assignmentToken: z.string().optional(),
	leaseExpiresAt: z.number().int().nonnegative().optional(),
	task: taskClaimPullTaskSchema.optional(),
	reasonCode: z
		.enum([
			'worker_busy',
			'task_not_found',
			'task_not_claimable',
			'already_claimed',
			'commitment_exists',
			'suggestion_policy_mismatch',
		])
		.optional(),
	reason: z.string().optional(),
});

export type ITaskClaimPullTask = z.infer<typeof taskClaimPullTaskSchema>;
export type ITaskClaimPullResultPayload = z.infer<
	typeof taskClaimPullResultPayloadSchema
>;
