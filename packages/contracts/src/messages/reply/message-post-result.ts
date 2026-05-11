import { z } from 'zod';

export const MESSAGE_POST_RESULT = 'message:post:result' as const;

export const messagePostResultPayloadSchema = z.object({
	messageId: z.string(),
	createdAt: z.number().int().nonnegative(),
	expiresAt: z.number().int().nonnegative().optional(),
});

export type IMessagePostResultPayload = z.infer<
	typeof messagePostResultPayloadSchema
>;
