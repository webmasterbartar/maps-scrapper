// index.js
const Controller = require('./src/controller');
const logger = require('./src/utils/logger');

// Example Inputs - In a real app, these might come from CLI args or a file
const KEYWORDS = ['کافه', 'رستوران'];
const PROVINCES = ['تهران'];

async function main() {
    logger.info('Starting Google Maps Scraper...');

    const controller = new Controller(KEYWORDS, PROVINCES);
    await controller.start();
}

main().catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
});
