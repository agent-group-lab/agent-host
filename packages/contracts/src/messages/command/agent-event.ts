import type { z } from 'zod';
import { agentEventEnvelopeSchema } from '~/agent/models.schema';

export const AGENT_EVENT = 'agent:event' as const;

export const agentEventPayloadSchema = agentEventEnvelopeSchema;

export type IAgentEventPayload = z.infer<typeof agentEventPayloadSchema>;
