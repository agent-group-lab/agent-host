import { z } from 'zod';

import { workStateSchema } from '~/work/state';
import { inboxEntryStatusSchema } from '../command/inbox-list';

export const INBOX_LIST_RESULT = 'inbox:list:result' as const;

export const inboxListItemWorkSchema = z.discriminatedUnion('workKind', [
	z.object({
		workKind: z.literal('direct'),
		workId: z.string(),
		targetAgentId: z.string(),
		sourceAgentId: z.string(),
		priority: z.number(),
		deadline: z.number().optional(),
		payloadRef: z.object({
			requestId: z.string(),
			sourceTaskId: z.string().optional(),
		}),
	}),
	z.object({
		workKind: z.literal('task'),
		workId: z.string(),
		targetAgentId: z.string(),
		sourceAgentId: z.string(),
		priority: z.number(),
		deadline: z.number().optional(),
		payloadRef: z.object({
			taskId: z.string(),
		}),
	}),
]);

export const inboxListItemSchema = z.object({
	entryId: z.string(),
	toAgentId: z.string(),
	toAgentName: z.string().optional(),
	fromAgentId: z.string(),
	fromAgentName: z.string().optional(),
	requestId: z.string(),
	status: inboxEntryStatusSchema,
	work: inboxListItemWorkSchema,
	payload: z.record(z.string(), z.unknown()),
	createdAt: z.number(),
	updatedAt: z.number(),
	online: z.boolean(),
	workState: workStateSchema.nullable(),
});

export const inboxListResultPayloadSchema = z.object({
	targetAgentId: z.string(),
	entries: z.array(inboxListItemSchema),
});

export type IInboxListItem = z.infer<typeof inboxListItemSchema>;
export type IInboxListResultPayload = z.infer<
	typeof inboxListResultPayloadSchema
>;
