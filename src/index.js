// src/index.js
// Entry point for Google Maps scraper
const Controller = require('./controller');
const config = require('./config');
const logger = require('./utils/logger');

function parseCliArray(argName) {
  const raw = process.argv.find(a => a.startsWith(`--${argName}=`));
  if (!raw) return null;
  return raw
    .split('=')[1]
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

async function main() {
  // Read keywords/provinces from CLI or fall back to simple defaults
  // Example:
  //   node src/index.js --keywords="کافه,رستوران" --provinces="تهران,اصفهان"
  let keywords = parseCliArray('keywords');
  let provinces = parseCliArray('provinces');

  if (!keywords || keywords.length === 0) {
    logger.warn('No --keywords provided, using default: ["کافه"]');
    keywords = ['کافه'];
  }
  if (!provinces || provinces.length === 0) {
    logger.warn('No --provinces provided, using all Iran provinces');
    provinces = config.IRAN_PROVINCES || ['تهران'];
    logger.info(`Will process ${provinces.length} provinces: ${provinces.join(', ')}`);
  }

  const controller = new Controller(keywords, provinces);
  await controller.start();
}

main().catch(err => {
  logger.error('Fatal error in main', { err: err?.stack || err?.message || err });
  process.exitCode = 1;
});


