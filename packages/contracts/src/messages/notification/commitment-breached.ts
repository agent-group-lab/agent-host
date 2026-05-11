import { z } from 'zod';

export const COMMITMENT_BREACHED = 'commitment:breached' as const;

export const commitmentBreachedPayloadSchema = z.object({
	taskId: z.string(),
	agentId: z.string(),
	agentName: z.string(),
	reason: z.string(),
});

export type ICommitmentBreachedPayload = z.infer<
	typeof commitmentBreachedPayloadSchema
>;
