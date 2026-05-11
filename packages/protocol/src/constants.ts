export const PROTOCOL_VERSION = 1 as const;

export type ProtocolChannel =
	| 'control'
	| `room:${string}`
	| `task:${string}`
	| `direct:${string}`;
