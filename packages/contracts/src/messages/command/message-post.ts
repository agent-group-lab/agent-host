import { z } from 'zod';
import { nonNegativeIntegerSchema } from '~/shared/schemas';

export const MESSAGE_POST = 'message:post' as const;

export const messagePostPayloadSchema = z.object({
	messageId: z.string().min(1),
	fromAgentId: z.string(),
	fromAgentName: z.string(),
	toAgentId: z.string().optional(),
	content: z.string().min(1).max(32_768),
	ttlMs: nonNegativeIntegerSchema.optional(),
});

export type IMessagePostPayload = z.infer<typeof messagePostPayloadSchema>;
