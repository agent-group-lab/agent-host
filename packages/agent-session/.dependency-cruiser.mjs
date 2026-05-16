import getConfig from '@infra/dep-presets';

const config = getConfig();

const peerRuntimeDependencyPaths = [
	'node_modules/[.]pnpm/ink@',
	'node_modules/[.]pnpm/mobx@',
	'node_modules/[.]pnpm/mobx-react-lite@',
	'node_modules/[.]pnpm/react@',
	'node_modules/ink/',
	'node_modules/mobx/',
	'node_modules/mobx-react-lite/',
	'node_modules/react/',
];

const rulesAllowingPeerRuntimeDependencies = new Set([
	'no-duplicate-dep-types',
	'not-to-dev-dep',
	'peer-deps-used',
]);

config.forbidden = config.forbidden.map((rule) => {
	if (!rulesAllowingPeerRuntimeDependencies.has(rule.name)) {
		return rule;
	}

	return {
		...rule,
		to: {
			...rule.to,
			pathNot: [...(rule.to.pathNot ?? []), ...peerRuntimeDependencyPaths],
		},
	};
});

export default config;
