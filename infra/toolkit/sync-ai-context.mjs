#!/usr/bin/env node
// @ts-check

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {'rules' | 'core' | 'arch' | 'coding' | 'output' | 'examples'} FragmentId */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const fragmentsDir = path.join(repoRoot, 'infra', 'ai-context', 'fragments');
const contextPath = path.join(repoRoot, 'infra', 'ai-context', 'CONTEXT.md');
const specificPath = path.join(
	repoRoot,
	'infra',
	'ai-context',
	'fragments',
	'specific.md',
);

/** @type {FragmentId[]} */
const FRAGMENT_IDS = ['rules', 'core', 'arch', 'coding', 'output', 'examples'];

/** @type {Record<FragmentId, string>} */
const FRAGMENT_TITLES = {
	rules: 'Rules & Guardrails',
	core: 'Core Project Context',
	arch: 'Architecture Notes',
	coding: 'Coding Style',
	output: 'Output & Collaboration Expectations',
	examples: 'Examples & Patterns',
};

/** @type {Record<string, string>} */
const fragmentCache = {};

/**
 * @param {FragmentId} id
 */
async function loadFragment(id) {
	if (fragmentCache[id]) {
		return fragmentCache[id];
	}
	const filePath = path.join(fragmentsDir, `${id}.md`);
	const raw = await readFile(filePath, 'utf8');
	const normalized = raw
		.replace(/^\uFEFF?/, '')
		.replace(/^# [^\n]+\n+/, '')
		.trim();
	fragmentCache[id] = normalized;
	return normalized;
}

/**
 * @param {object} params
 * @param {string} params.title
 * @param {string[]} [params.introLines]
 * @param {FragmentId[]} params.fragments
 * @param {{ heading: string; body: string; }[]} [params.extraSections]
 */
async function buildDocument({
	title,
	introLines = [],
	fragments,
	extraSections = [],
}) {
	const sections = [];
	for (const fragmentId of fragments) {
		const content = await loadFragment(fragmentId);
		sections.push(`## ${FRAGMENT_TITLES[fragmentId]}\n\n${content}\n`);
	}
	for (const extra of extraSections) {
		sections.push(`## ${extra.heading}\n\n${extra.body.trim()}\n`);
	}
	const intro = [title, '', ...introLines, introLines.length ? '' : '']
		.join('\n')
		.trim();
	return `${`${intro}\n\n${sections.join('\n---\n\n')}`.trim()}\n`;
}

/**
 * @param {string} input
 */
function slugify(input) {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/**
 * @returns {Promise<Record<string, { heading: string; body: string }>>}
 */
async function loadSpecificInstructions() {
	try {
		const raw = await readFile(specificPath, 'utf8');
		const lines = raw.replace(/^\uFEFF?/, '').split(/\r?\n/);
		const sections =
			/** @type {Record<string, { heading: string; body: string }>} */ ({});
		let currentKey = '';
		let currentHeading = '';
		/** @type {string[]} */
		let buffer = [];

		for (const line of lines) {
			if (line.startsWith('# ')) {
				continue;
			}
			if (line.startsWith('## ')) {
				if (currentKey) {
					sections[currentKey] = {
						heading: currentHeading,
						body: buffer.join('\n').trim(),
					};
				}
				currentHeading = line.slice(3).trim();
				currentKey = slugify(currentHeading);
				buffer = [];
				continue;
			}
			buffer.push(line);
		}

		if (currentKey) {
			sections[currentKey] = {
				heading: currentHeading,
				body: buffer.join('\n').trim(),
			};
		}

		return sections;
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
			return {};
		}
		throw error;
	}
}

/**
 * @typedef {object} ModelProfile
 * @property {string} name
 * @property {string} output
 * @property {string} title
 * @property {string[]} intro
 * @property {FragmentId[]} fragments
 * @property {{ heading: string; body: string }[]} [extras]
 * @property {string} [specificKey]
 */

/** @type {ModelProfile[]} */
const modelProfiles = [
	{
		name: 'Claude',
		output: path.join(repoRoot, 'CLAUDE.md'),
		title: '# Claude Project Context',
		intro: [
			'⚠️ AUTO-GENERATED. DO NOT EDIT.',
			'Content assembled from ai/CONTEXT.md fragments for Claude Code.',
		],
		fragments: /** @type {FragmentId[]} */ ([
			'rules',
			'core',
			'arch',
			'coding',
			'output',
			'examples',
		]),
		specificKey: 'claude-specific-instructions',
	},
	{
		name: 'Agents',
		output: path.join(repoRoot, 'AGENTS.md'),
		title: '# Global Agent Instructions',
		intro: [
			'⚠️ AUTO-GENERATED. DO NOT EDIT.',
			'Used by ChatGPT / Codex-compatible agents. Source of truth: ai/CONTEXT.md fragments.',
		],
		fragments: /** @type {FragmentId[]} */ ([
			'rules',
			'core',
			'arch',
			'coding',
			'output',
			'examples',
		]),
		specificKey: 'agents-specific-instructions',
	},
	{
		name: 'Gemini',
		output: path.join(repoRoot, 'GEMINI.md'),
		title: '# Gemini Project Context',
		intro: [
			'⚠️ AUTO-GENERATED. DO NOT EDIT.',
			'Optimized for Gemini Code Assist (prefers compact contexts).',
		],
		fragments: /** @type {FragmentId[]} */ ([
			'rules',
			'core',
			'coding',
			'output',
		]),
		specificKey: 'gemini-specific-instructions',
	},
];

async function main() {
	const canonicalDoc = await buildDocument({
		title: '# Canonical Context',
		introLines: [
			'⚠️ AUTO-GENERATED. DO NOT EDIT BY HAND.',
			'Edit files under `ai/fragments/*.md` and run `pnpm run nx sync:context @infra/toolkit` to update this document and the root-level adapters.',
		],
		fragments: FRAGMENT_IDS,
	});
	await writeFile(contextPath, `${canonicalDoc}`);

	const specificSections = await loadSpecificInstructions();

	for (const profile of modelProfiles) {
		const extraSections = [...(profile.extras ?? [])];
		if (profile.specificKey) {
			const specific = specificSections[profile.specificKey];
			if (specific) {
				extraSections.push(specific);
			}
		}
		const doc = await buildDocument({
			title: profile.title,
			introLines: profile.intro,
			fragments: profile.fragments,
			extraSections,
		});
		await writeFile(profile.output, `${doc}`);
	}

	console.log(
		'Context synchronized:',
		[
			path.relative(repoRoot, contextPath),
			...modelProfiles.map((p) => path.relative(repoRoot, p.output)),
		].join(', '),
	);
}

main().catch((error) => {
	console.error('Failed to sync AI context.');
	console.error(error);
	process.exitCode = 1;
});
