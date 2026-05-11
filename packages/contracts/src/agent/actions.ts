export type CommunicationAction =
	| 'ACK'
	| 'CLARIFY'
	| 'DEFER'
	| 'ROUTE'
	| 'IGNORE'
	| 'DELIVER';

export type CommitmentAction =
	| 'ACCEPT'
	| 'DECLINE'
	| 'ESCALATE'
	| 'UPDATE'
	| 'DELIVER'
	| 'FAIL';

export type AgentAction = CommunicationAction | CommitmentAction;
