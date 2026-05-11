import { z } from 'zod';

export const transitionEventTypeSchema = z.enum([
	'membership:status_changed',
	'membership:joined',
	'membership:left',
	'work:status_changed',
	'task:status_changed',
	'commitment:status_changed',
	'delegation:status_changed',
	'inbox:status_changed',
	'work:online',
	'work:offline',
	'work:focused',
	'work:finished',
	'work:waiting_tool',
	'work:waiting_delegation',
	'task:assigned',
	'task:started',
	'task:completed',
	'task:cancelled',
	'task:blocked',
	'commitment:accepted',
	'commitment:delivered',
	'commitment:breached',
	'delegation:accepted',
	'delegation:completed',
	'delegation:rejected',
]);

export const transitionEventSchema = z.object({
	schemaVersion: z.number().int().positive().default(1),
	eventId: z.string(),
	eventType: transitionEventTypeSchema,
	aggregateType: z.enum([
		'work',
		'task',
		'commitment',
		'delegation',
		'inbox',
		'membership',
	]),
	aggregateId: z.string(),
	fromState: z.string(),
	toState: z.string(),
	trigger: z.string(),
	occurredAt: z.number().int().nonnegative(),
	actor: z.string(),
	actorName: z.string().optional(),
	correlationId: z.string(),
	causationId: z.string(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ITransitionEvent = z.infer<typeof transitionEventSchema>;
export type TransitionEventType = z.infer<typeof transitionEventTypeSchema>;
