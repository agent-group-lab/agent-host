import { z } from 'zod';

export const INBOX_LIST = 'inbox:list' as const;

export const inboxEntryStatusSchema = z.enum([
	'queued',
	'reserved',
	'dispatched',
	'completed',
	'dropped',
]);

export const inboxListPayloadSchema = z.object({
	targetAgentId: z.string().min(1),
	status: inboxEntryStatusSchema.optional(),
});

export type IInboxEntryStatus = z.infer<typeof inboxEntryStatusSchema>;
export type IInboxListPayload = z.infer<typeof inboxListPayloadSchema>;
