import { z } from 'zod';

export const MEMBER_LEAVE = 'member:leave' as const;

export const memberLeavePayloadSchema = z.object({
	agentId: z.string(),
});

export type IMemberLeavePayload = z.infer<typeof memberLeavePayloadSchema>;
