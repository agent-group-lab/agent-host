const { argv } = require('node:process');
const checkUpdatePckJson = require('./check-update-pckjson');
const autoUpdateNcu = require('./auto-update-ncu');

const isWrite = !!argv.find((v) => v === '--write');
const isAuto = !!argv.find((v) => v === '--auto');

async function ncu() {
	if (isAuto) {
		await autoUpdateNcu();
	}
	checkUpdatePckJson({ isWrite });
}

ncu();
