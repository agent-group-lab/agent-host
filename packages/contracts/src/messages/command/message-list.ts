import { z } from 'zod';

export const MESSAGE_LIST = 'message:list' as const;

export const messageCursorSchema = z.object({
	createdAt: z.number().int().nonnegative(),
	messageId: z.string(),
});

export const messageListPayloadSchema = z.object({
	toAgentId: z.string().min(1),
	scope: z.enum(['direct', 'broadcast', 'all']).default('all'),
	after: messageCursorSchema.optional(),
	limit: z.number().int().positive().max(200).optional(),
});

export type IMessageCursor = z.infer<typeof messageCursorSchema>;
export type IMessageListPayload = z.infer<typeof messageListPayloadSchema>;
