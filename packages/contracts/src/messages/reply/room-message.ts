import { z } from 'zod';

export const roomMessageSchema = z.object({
	messageId: z.string().min(1),
	fromAgentId: z.string(),
	fromAgentName: z.string(),
	toAgentId: z.string().optional(),
	toAgentName: z.string().optional(),
	content: z.string(),
	createdAt: z.number().int().nonnegative(),
	expiresAt: z.number().int().nonnegative().optional(),
});

export type IRoomMessage = z.infer<typeof roomMessageSchema>;
