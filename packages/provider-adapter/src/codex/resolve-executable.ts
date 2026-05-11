import {
	findFileInAncestorNodeModules,
	findFileInPnpmPackages,
	resolveCommandPath,
} from '~/shared';

const resolveTargetTriple = () => {
	const { platform, arch } = process;

	if ((platform === 'linux' || platform === 'android') && arch === 'x64') {
		return 'x86_64-unknown-linux-musl';
	}
	if ((platform === 'linux' || platform === 'android') && arch === 'arm64') {
		return 'aarch64-unknown-linux-musl';
	}
	if (platform === 'darwin' && arch === 'x64') {
		return 'x86_64-apple-darwin';
	}
	if (platform === 'darwin' && arch === 'arm64') {
		return 'aarch64-apple-darwin';
	}
	if (platform === 'win32' && arch === 'x64') {
		return 'x86_64-pc-windows-msvc';
	}
	if (platform === 'win32' && arch === 'arm64') {
		return 'aarch64-pc-windows-msvc';
	}

	return undefined;
};

const resolveVendorBinary = () => {
	const targetTriple = resolveTargetTriple();
	if (!targetTriple) {
		return undefined;
	}

	const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';
	return findFileInPnpmPackages('@openai+codex@', [
		'@openai',
		'codex',
		'vendor',
		targetTriple,
		'codex',
		binaryName,
	]);
};

export const resolveExecutable = (): string | undefined => {
	const isWin = process.platform === 'win32';
	const factories = [
		() => process.env.CODEX_EXECUTABLE,
		resolveVendorBinary,
		() =>
			findFileInAncestorNodeModules(isWin ? '.bin/codex.cmd' : '.bin/codex'),
		() =>
			findFileInAncestorNodeModules(
				isWin
					? '@openai/codex-sdk/node_modules/.bin/codex.cmd'
					: '@openai/codex-sdk/node_modules/.bin/codex',
			),
		() => resolveCommandPath('codex'),
		// Bun --compile may break codex-sdk's module-based auto discovery.
		// Fall back to command lookup semantics via PATH.
		() => (process.versions.bun ? 'codex' : undefined),
	];

	for (const factory of factories) {
		const candidate = factory();
		if (candidate) return candidate;
	}

	return undefined;
};
