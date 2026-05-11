import { existsSync } from 'node:fs';
import {
	findFileInAncestorNodeModules,
	findFileInPnpmPackages,
	resolveCommandPath,
} from '~/shared';

const resolveEnvExecutable = () => {
	const envOverride = process.env.CLAUDE_CODE_EXECUTABLE;
	if (!envOverride) {
		return undefined;
	}

	const resolved = resolveCommandPath(envOverride);
	if (resolved && existsSync(resolved)) {
		return resolved;
	}

	return envOverride;
};

export const resolveExecutable = (): string | undefined => {
	const factories = [
		resolveEnvExecutable,
		() =>
			findFileInAncestorNodeModules('@anthropic-ai/claude-agent-sdk/cli.js'),
		() =>
			findFileInPnpmPackages('@anthropic-ai+claude-agent-sdk@', [
				'@anthropic-ai',
				'claude-agent-sdk',
				'cli.js',
			]),
		() => resolveCommandPath('claude'),
		() => resolveCommandPath('claude-code'),
	];

	for (const factory of factories) {
		const candidate = factory();
		if (candidate) return candidate;
	}

	return undefined;
};
