import { z } from 'zod';

export const promptEventLogEntrySchema = z.object({
	kind: z.literal('prompt'),
	content: z.string(),
});

export const textEventLogEntrySchema = z.object({
	kind: z.literal('text'),
	content: z.string(),
});

export const toolPendingEventLogEntrySchema = z.object({
	kind: z.literal('tool'),
	toolName: z.string(),
	done: z.literal(false),
});

export const toolDoneEventLogEntrySchema = z.object({
	kind: z.literal('tool'),
	toolName: z.string(),
	done: z.literal(true),
	output: z.string(),
	isError: z.boolean(),
});

export const fileEventLogEntrySchema = z.object({
	kind: z.literal('file'),
	filePath: z.string(),
	operation: z.enum(['add', 'update', 'delete']),
});

export const errorEventLogEntrySchema = z.object({
	kind: z.literal('error'),
	message: z.string(),
});

export const eventLogEntrySchema = z.union([
	promptEventLogEntrySchema,
	textEventLogEntrySchema,
	toolPendingEventLogEntrySchema,
	toolDoneEventLogEntrySchema,
	fileEventLogEntrySchema,
	errorEventLogEntrySchema,
]);

export type IEventLogEntry = z.infer<typeof eventLogEntrySchema>;
