interface ISemanticAliasRule {
	fromState: string;
	toState: string;
	alias: string;
}

export const semanticAliasMap: Record<string, ISemanticAliasRule[]> = {
	'membership:status_changed': [
		{ fromState: 'none', toState: 'joined', alias: 'membership:joined' },
		{ fromState: 'joined', toState: 'none', alias: 'membership:left' },
	],
	'task:status_changed': [
		{ fromState: 'todo', toState: 'assigned', alias: 'task:assigned' },
		{ fromState: 'assigned', toState: 'doing', alias: 'task:started' },
		{ fromState: 'doing', toState: 'done', alias: 'task:completed' },
		{ fromState: 'doing', toState: 'cancelled', alias: 'task:cancelled' },
		{ fromState: 'doing', toState: 'blocked', alias: 'task:blocked' },
	],
	'work:status_changed': [
		{ fromState: 'offline', toState: 'idle', alias: 'work:online' },
		{ fromState: 'idle', toState: 'offline', alias: 'work:offline' },
		{ fromState: 'idle', toState: 'focused', alias: 'work:focused' },
		{ fromState: '*', toState: 'waiting_tool', alias: 'work:waiting_tool' },
		{
			fromState: '*',
			toState: 'waiting_delegation',
			alias: 'work:waiting_delegation',
		},
		{ fromState: '*', toState: 'finished', alias: 'work:finished' },
	],
	'commitment:status_changed': [
		{ fromState: 'none', toState: 'accepted', alias: 'commitment:accepted' },
		{
			fromState: 'accepted',
			toState: 'delivered',
			alias: 'commitment:delivered',
		},
		{ fromState: '*', toState: 'breached', alias: 'commitment:breached' },
	],
	'delegation:status_changed': [
		{ fromState: 'pending', toState: 'accepted', alias: 'delegation:accepted' },
		{
			fromState: 'accepted',
			toState: 'completed',
			alias: 'delegation:completed',
		},
		{ fromState: '*', toState: 'rejected', alias: 'delegation:rejected' },
	],
};

export const resolveSemanticAlias = (
	baseEventType: string,
	fromState: string,
	toState: string,
) => {
	const rules = semanticAliasMap[baseEventType] ?? [];
	return rules.find((rule) => {
		const fromMatched = rule.fromState === '*' || rule.fromState === fromState;
		const toMatched = rule.toState === '*' || rule.toState === toState;
		return fromMatched && toMatched;
	});
};
