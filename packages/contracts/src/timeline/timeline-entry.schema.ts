import { z } from 'zod';
import { agentEventEnvelopeSchema } from '../agent/models.schema';
import { transitionEventSchema } from '../events/transition-event';

export const replayCursorSchema = z.object({
	sessionId: z.string(),
	sessionStartedAt: z.number(),
	timelineSeq: z.number(),
	ts: z.number(),
});

export const hostCheckpointSchema = z.object({
	snapshot: z.unknown(),
	cursor: replayCursorSchema,
});

export const timelineEntrySchema = z.discriminatedUnion('kind', [
	z.object({
		sessionId: z.string(),
		timelineSeq: z.number(),
		ts: z.number(),
		kind: z.literal('agent'),
		agentEvent: agentEventEnvelopeSchema,
	}),
	z.object({
		sessionId: z.string(),
		timelineSeq: z.number(),
		ts: z.number(),
		kind: z.literal('transition'),
		transitionEvent: transitionEventSchema.nullable(),
	}),
]);

export type IReplayCursor = z.infer<typeof replayCursorSchema>;
export interface IHostCheckpoint<TSnapshot = unknown>
	extends Omit<z.infer<typeof hostCheckpointSchema>, 'snapshot'> {
	snapshot: TSnapshot;
}
export type ITimelineEntry = z.infer<typeof timelineEntrySchema>;
