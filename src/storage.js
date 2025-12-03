// src/storage.js
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');

/**
 * Ensures the temp directory exists.
 */
function ensureTempDir() {
    if (!fs.existsSync(config.TEMP_DIR)) {
        fs.mkdirSync(config.TEMP_DIR, { recursive: true });
    }
}

/**
 * Writes a batch of records to a temporary file atomically.
 * @param {Array} records 
 * @param {string} keyword 
 * @param {string} province 
 * @param {number} batchId 
 */
async function writeTempBatch(records, keyword, province, batchId) {
    ensureTempDir();
    // Sanitize filenames
    const safeKey = keyword.replace(/[^a-z0-9\u0600-\u06FF]/gi, '_');
    const safeProv = province.replace(/[^a-z0-9\u0600-\u06FF]/gi, '_');

    const filename = `${safeKey}_${safeProv}_part_${batchId}.json`;
    const filePath = path.join(config.TEMP_DIR, filename);
    const tempPath = filePath + '.tmp';

    try {
        fs.writeFileSync(tempPath, JSON.stringify(records, null, 2));
        fs.renameSync(tempPath, filePath); // Atomic rename
        logger.debug(`Written temp batch: ${filename}`);
    } catch (error) {
        logger.error(`Failed to write temp batch ${filename}: ${error.message}`);
    }
}

/**
 * Merges all temp files into a final result set, deduplicating by URL.
 * @returns {Array} Merged records
 */
async function mergeTempFiles() {
    ensureTempDir();
    const files = fs.readdirSync(config.TEMP_DIR).filter(f => f.endsWith('.json'));
    const allRecords = new Map();

    logger.info(`Merging ${files.length} temp files...`);

    for (const file of files) {
        try {
            const content = fs.readFileSync(path.join(config.TEMP_DIR, file), 'utf-8');
            const records = JSON.parse(content);
            records.forEach(r => {
                if (r.maps_url) {
                    allRecords.set(r.maps_url, r);
                }
            });
        } catch (e) {
            logger.error(`Error reading temp file ${file}: ${e.message}`);
        }
    }

    return Array.from(allRecords.values());
}

module.exports = {
    writeTempBatch,
    mergeTempFiles
};
