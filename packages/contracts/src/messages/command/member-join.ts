import { z } from 'zod';

export const MEMBER_JOIN = 'member:join' as const;

export const memberJoinPayloadSchema = z.object({
	agentId: z.string(),
	agentName: z.string(),
});

export type IMemberJoinPayload = z.infer<typeof memberJoinPayloadSchema>;
