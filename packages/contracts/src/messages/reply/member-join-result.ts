import { z } from 'zod';

export const MEMBER_JOIN_RESULT = 'member:join:result' as const;

export const memberJoinResultPayloadSchema = z.object({
	agentId: z.string(),
	agentName: z.string(),
	joinedAt: z.number(),
});

export type IMemberJoinResultPayload = z.infer<
	typeof memberJoinResultPayloadSchema
>;
