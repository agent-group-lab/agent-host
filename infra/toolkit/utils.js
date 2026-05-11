const YAML = require('yaml');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');

const rootPath = path.resolve(__dirname, '../../');

function readPackages() {
	const file = fs.readFileSync(
		path.resolve(rootPath, 'pnpm-workspace.yaml'),
		'utf8',
	);
	const workspace = YAML.parse(file);
	const packages = {
		boster: {
			name: 'boster',
			path: rootPath,
		},
	};
	workspace.packages.forEach((pckPath) => {
		const pckJsonPath = path.resolve(rootPath, pckPath, 'package.json');
		if (fs.existsSync(pckJsonPath)) {
			const pckJson = require(pckJsonPath);
			packages[pckJson.name] = {
				name: pckJson.name,
				path: path.resolve(rootPath, pckPath),
			};
		}
	});
	return packages;
}

async function getLatestVersion(name) {
	try {
		const { data: meta } = await axios.get(
			`https://registry.npmjs.org/${name}`,
		);
		return meta['dist-tags'].latest;
	} catch {
		console.error(`Failed to fetch ${name}`);
		return null;
	}
}

function formatVersion(value) {
	if (!value) {
		throw Error(`Invaild Version Value: ${value}`);
	}
	if (typeof value === 'string') {
		return [
			{
				version: value,
				locked: false,
			},
		];
	}
	if (Array.isArray(value)) {
		return value.flatMap((item) => formatVersion(item));
	}
	if (!value.version) {
		throw Error(`Invaild Version Value: ${value}`);
	}
	return [
		{
			locked: false,
			...value,
		},
	];
}

module.exports = {
	readPackages,
	getLatestVersion,
	formatVersion,
};
