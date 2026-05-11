import { z } from 'zod';

export const MEMBER_LEAVE_RESULT = 'member:leave:result' as const;

export const memberLeaveResultPayloadSchema = z.object({
	agentId: z.string(),
	removed: z.boolean(),
});

export type IMemberLeaveResultPayload = z.infer<
	typeof memberLeaveResultPayloadSchema
>;
