export type ISessionStatus =
	| 'idle'
	| 'starting'
	| 'running'
	| 'disconnected'
	| 'rejected'
	| 'error';

// Runtime-supported values: 'lead' | 'executor' (agt-tui business values)
export type ISessionWorkerMode = string;
