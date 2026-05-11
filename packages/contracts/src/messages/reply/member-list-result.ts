import { z } from 'zod';
import { workStateSchema } from '~/work/state';

export const MEMBER_LIST_RESULT = 'member:list:result' as const;

export const memberListItemSchema = z.object({
	agentId: z.string(),
	agentName: z.string(),
	joinedAt: z.number(),
	online: z.boolean(),
	workState: workStateSchema.nullable(),
});

export const memberListResultPayloadSchema = z.object({
	members: z.array(memberListItemSchema),
});

export type IMemberListItem = z.infer<typeof memberListItemSchema>;
export type IMemberListResultPayload = z.infer<
	typeof memberListResultPayloadSchema
>;
