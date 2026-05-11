import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
	AgentEvent,
	CreateEventInput,
} from '@agent-group-lab/contracts/agent';
import { nanoid } from 'nanoid';

export const createEvent = <T extends CreateEventInput>(
	base: T,
): AgentEvent => {
	return {
		id: nanoid(),
		ts: Date.now(),
		...base,
	} as AgentEvent;
};

const buildAncestorDirectories = () => {
	const directories: string[] = [];
	let current = process.cwd();

	while (true) {
		directories.push(current);
		const parent = dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
	}

	return directories;
};

const readFirstLine = (value: string) => {
	return value
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0);
};

export const resolveCommandPath = (command: string) => {
	const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
	const result = spawnSync(lookupCommand, [command], {
		encoding: 'utf8',
	});

	if (result.status !== 0 || !result.stdout) {
		return undefined;
	}

	return readFirstLine(result.stdout);
};

export const findFileInAncestorNodeModules = (relativePath: string) => {
	for (const base of buildAncestorDirectories()) {
		const candidate = join(base, 'node_modules', relativePath);
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	return undefined;
};

export const serializeToolResult = (value: unknown) => {
	if (typeof value === 'string') {
		return value;
	}
	try {
		return JSON.stringify(value ?? null);
	} catch {
		return String(value);
	}
};

export const findFileInPnpmPackages = (
	packagePrefix: string,
	relativePathInPackage: string[],
) => {
	for (const base of buildAncestorDirectories()) {
		const pnpmDir = join(base, 'node_modules', '.pnpm');
		if (!existsSync(pnpmDir)) {
			continue;
		}

		const entries = readdirSync(pnpmDir, {
			withFileTypes: true,
		});
		for (const entry of entries) {
			if (!entry.isDirectory() || !entry.name.startsWith(packagePrefix)) {
				continue;
			}
			const candidate = join(
				pnpmDir,
				entry.name,
				'node_modules',
				...relativePathInPackage,
			);
			if (existsSync(candidate)) {
				return candidate;
			}
		}
	}

	return undefined;
};
