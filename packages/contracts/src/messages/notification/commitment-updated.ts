import { z } from 'zod';

import type { CommitmentAction } from '~/agent/actions';

export const COMMITMENT_UPDATED = 'commitment:updated' as const;

export const commitmentUpdatedPayloadSchema = z.object({
	taskId: z.string(),
	agentId: z.string(),
	agentName: z.string(),
	action: z.custom<CommitmentAction>(
		(value) =>
			value === 'ACCEPT' ||
			value === 'DECLINE' ||
			value === 'ESCALATE' ||
			value === 'UPDATE' ||
			value === 'DELIVER' ||
			value === 'FAIL',
	),
	status: z.enum(['none', 'accepted', 'delivered', 'failed', 'breached']),
});

export type ICommitmentUpdatedPayload = z.infer<
	typeof commitmentUpdatedPayloadSchema
>;
