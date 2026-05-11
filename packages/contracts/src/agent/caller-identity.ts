export type ICallerIdentity =
	| { kind: 'agent'; agentId: string; agentName: string }
	| { kind: 'local-user' }
	| { kind: 'system'; reason?: string };
