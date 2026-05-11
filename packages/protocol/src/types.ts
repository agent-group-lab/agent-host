import type { z } from 'zod';
import { PROTOCOL_VERSION } from './constants';

export type { ProtocolChannel } from './constants';
export { PROTOCOL_VERSION };

import type {
	ackPayloadSchema,
	controlDisconnectPayloadSchema,
	controlHeartbeatPayloadSchema,
	controlHelloPayloadSchema,
	controlMessageSchema,
	controlReadyPayloadSchema,
	eventsSinceRequestPayloadSchema,
	eventsSinceResultPayloadSchema,
	protocolActorSchema,
	protocolEnvelopeSchema,
	protocolErrorPayloadSchema,
	protocolTraceSchema,
} from './schemas';

type IProtocolEnvelopeSchema = z.infer<typeof protocolEnvelopeSchema>;

export interface IProtocolEnvelope<
	TType extends string = IProtocolEnvelopeSchema['type'],
	TPayload = IProtocolEnvelopeSchema['payload'],
> extends Omit<IProtocolEnvelopeSchema, 'type' | 'payload'> {
	type: TType;
	payload: TPayload;
}

export type IProtocolActor = z.infer<typeof protocolActorSchema>;

export type IProtocolTrace = z.infer<typeof protocolTraceSchema>;

export interface ICreateEnvelopeInput<
	TType extends string = IProtocolEnvelope['type'],
	TPayload = unknown,
> {
	id?: string;
	ts?: number;
	v?: typeof PROTOCOL_VERSION;
	seq: number;
	type: TType;
	channel: IProtocolEnvelope['channel'];
	roomId?: string;
	actor?: IProtocolActor;
	trace?: IProtocolTrace;
	payload: TPayload;
}

export type IControlHelloPayload = z.infer<typeof controlHelloPayloadSchema>;

export type IControlReadyPayload = z.infer<typeof controlReadyPayloadSchema>;

export type IControlHeartbeatPayload = z.infer<
	typeof controlHeartbeatPayloadSchema
>;

export type IAckPayload = z.infer<typeof ackPayloadSchema>;

export type IEventsSinceRequestPayload = z.infer<
	typeof eventsSinceRequestPayloadSchema
>;

export type IEventsSinceResultPayload = z.infer<
	typeof eventsSinceResultPayloadSchema
>;

export type IProtocolErrorPayload = z.infer<typeof protocolErrorPayloadSchema>;

export type IControlDisconnectPayload = z.infer<
	typeof controlDisconnectPayloadSchema
>;

export type IControlMessage = z.infer<typeof controlMessageSchema>;

export type ControlMessageType = IControlMessage['type'];
