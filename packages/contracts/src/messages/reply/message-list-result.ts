import { z } from 'zod';
import { messageCursorSchema } from '../command/message-list';
import { roomMessageSchema } from './room-message';

export const MESSAGE_LIST_RESULT = 'message:list:result' as const;

export const messageListResultPayloadSchema = z.object({
	messages: z.array(roomMessageSchema),
	nextCursor: messageCursorSchema.optional(),
});

export type IMessageListResultPayload = z.infer<
	typeof messageListResultPayloadSchema
>;
