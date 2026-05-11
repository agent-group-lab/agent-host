import { z } from 'zod';

import { nonNegativeIntegerSchema } from '~/shared/schemas';

export const COMMITMENT_ACTION = 'commitment:action' as const;

const acceptCommitmentActionPayloadSchema = z.object({
	action: z.literal('ACCEPT'),
	taskId: z.string(),
	deliverableSpec: z.string().optional(),
	slaDeadline: nonNegativeIntegerSchema.optional(),
});

const declineCommitmentActionPayloadSchema = z.object({
	action: z.literal('DECLINE'),
	taskId: z.string(),
	reason: z.string(),
	suggestedAssignee: z.string().optional(),
});

const escalateCommitmentActionPayloadSchema = z.object({
	action: z.literal('ESCALATE'),
	taskId: z.string(),
	decisionNeeded: z.string(),
});

const updateCommitmentActionPayloadSchema = z.object({
	action: z.literal('UPDATE'),
	taskId: z.string(),
	progress: z.string(),
});

const deliverCommitmentActionPayloadSchema = z
	.object({
		action: z.literal('DELIVER'),
		taskId: z.string(),
		artifact: z.unknown().optional(),
	})
	.refine((payload) => Object.hasOwn(payload, 'artifact'), {
		path: ['artifact'],
		message: 'artifact is required',
	});

const failCommitmentActionPayloadSchema = z.object({
	action: z.literal('FAIL'),
	taskId: z.string(),
	reason: z.string(),
});

export const commitmentActionPayloadSchema = z.discriminatedUnion('action', [
	acceptCommitmentActionPayloadSchema,
	declineCommitmentActionPayloadSchema,
	escalateCommitmentActionPayloadSchema,
	updateCommitmentActionPayloadSchema,
	deliverCommitmentActionPayloadSchema,
	failCommitmentActionPayloadSchema,
]);

export type ICommitmentActionPayload = z.infer<
	typeof commitmentActionPayloadSchema
>;
