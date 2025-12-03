// src/controller.js
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
const { launchBrowser } = require('./utils/browser');
const { fetchLinksForQuery } = require('./fetcher');
const { processDetail } = require('./worker');
const { createObjectCsvWriter } = require('csv-writer');
const { retry, isNetworkError } = require('./utils/robustness');

class Controller {
    constructor(keywords, provinces) {
        this.keywords = keywords;
        this.provinces = provinces;
        this.queue = [];
        this.results = [];
        this.browser = null;
    }

    async init() {
        this.browser = await launchBrowser();
        logger.info('Browser launched.');
        
        // Listen for browser disconnect events
        this.browser.on('disconnected', () => {
            logger.warn('Browser disconnected! Will attempt to relaunch...');
            this.ensureBrowser();
        });
    }

    /**
     * Ensures browser is connected, relaunches if needed.
     */
    async ensureBrowser() {
        try {
            if (!this.browser || !this.browser.isConnected()) {
                logger.info('Relaunching browser...');
                if (this.browser) {
                    try {
                        await this.browser.close();
                    } catch (e) {
                        // Ignore close errors
                    }
                }
                this.browser = await launchBrowser();
                this.browser.on('disconnected', () => {
                    logger.warn('Browser disconnected again! Will attempt to relaunch...');
                    this.ensureBrowser();
                });
                logger.info('Browser relaunched successfully.');
            }
        } catch (error) {
            logger.error(`Failed to relaunch browser: ${error.message}. Retrying in 10s...`);
            await new Promise(resolve => setTimeout(resolve, 10000));
            return this.ensureBrowser();
        }
    }

    async start() {
        try {
            await this.init();

            // 1. Generate Search Queries and Fetch Links
            // هر کوئری به صورت مستقل با retry انجام می‌شود تا اگر یکی fail شد، بقیه ادامه پیدا کنند
            const totalQueries = this.provinces.length * this.keywords.length;
            let completedQueries = 0;

            for (const province of this.provinces) {
                for (const keyword of this.keywords) {
                    const query = `${keyword} ${province}`;
                    completedQueries++;
                    logger.info(`[${completedQueries}/${totalQueries}] Starting search for: ${query}`);

                    try {
                        // اطمینان از اینکه browser متصل است
                        await this.ensureBrowser();
                        
                        // Retry با منطق قوی برای قطع اینترنت
                        const links = await retry(
                            async () => {
                                await this.ensureBrowser(); // Check again before each retry
                                return await fetchLinksForQuery(this.browser, query);
                            },
                            config.RETRY_LIMIT,
                            config.RETRY_DELAY_BASE,
                            config.RETRY_DELAY_MAX
                        );

                        logger.info(`✓ Fetched ${links.length} links for ${query}`);

                        // Add to queue with metadata
                        links.forEach(link => {
                            this.queue.push({
                                link,
                                metadata: { keyword, province }
                            });
                        });
                    } catch (error) {
                        // اگر بعد از همه retryها هم fail شد، لاگ می‌کنیم ولی ادامه می‌دهیم
                        logger.error(
                            `✗ Failed to fetch links for ${query} after all retries: ${error.message}. ` +
                            `Continuing with next query...`
                        );
                        // یک رکورد خالی با status error اضافه می‌کنیم تا track شود
                        this.queue.push({
                            link: { href: `FAILED:${query}`, text: query },
                            metadata: { keyword, province },
                            error: error.message
                        });
                    }
                }
            }

            logger.info(`Total items in queue: ${this.queue.length}`);

            // 2. Process Queue with Worker Pool
            await this.processQueue();

            // 3. Save Final Results
            await this.saveResults();

        } catch (error) {
            logger.error(`Controller Error: ${error.message}`);
        } finally {
            if (this.browser) await this.browser.close();
            logger.info('Browser closed. Job finished.');
        }
    }

    async processQueue() {
        const poolSize = config.CONCURRENCY_WORKERS;
        const total = this.queue.length;
        let processed = 0;
        let currentBatch = [];
        const BATCH_SIZE = 5; // Write to disk every 5 items

        while (this.queue.length > 0) {
            const batch = this.queue.splice(0, poolSize);
            const promises = batch.map(async (item) => {
                // Skip failed queries from search phase
                if (item.link.href && item.link.href.startsWith('FAILED:')) {
                    processed++;
                    return;
                }

                try {
                    // اطمینان از اینکه browser متصل است
                    await this.ensureBrowser();
                    
                    // Retry برای processDetail هم (مخصوصاً برای قطع اینترنت)
                    const result = await retry(
                        async () => {
                            await this.ensureBrowser(); // Check again before each retry
                            return await processDetail(this.browser, item.link, item.metadata);
                        },
                        config.RETRY_LIMIT,
                        config.RETRY_DELAY_BASE,
                        config.RETRY_DELAY_MAX
                    );

                    // Add to current batch for temp storage
                    currentBatch.push(result);

                    if (currentBatch.length >= BATCH_SIZE) {
                        const batchToWrite = [...currentBatch];
                        currentBatch = [];
                        await require('./storage').writeTempBatch(
                            batchToWrite,
                            item.metadata.keyword,
                            item.metadata.province,
                            Date.now() + Math.random()
                        );
                    }

                } catch (e) {
                    // اگر بعد از همه retryها هم fail شد، یک رکورد error می‌سازیم
                    logger.error(`Worker failed for ${item.link.href} after all retries: ${e.message}`);
                    const errorResult = {
                        keyword: item.metadata.keyword,
                        province: item.metadata.province,
                        maps_url: item.link.href,
                        name: item.link.text || 'Unknown',
                        phones: [],
                        raw_phone_strings: [],
                        address: null,
                        category: null,
                        extraction_source: null,
                        timestamp: new Date().toISOString(),
                        status: 'error',
                        error: e.message
                    };
                    currentBatch.push(errorResult);
                } finally {
                    processed++;
                    if (processed % 10 === 0) {
                        logger.info(`Progress: ${processed}/${total} (${Math.round(processed/total*100)}%)`);
                    }
                }
            });

            await Promise.all(promises);
        }

        // Write remaining items
        if (currentBatch.length > 0) {
            await require('./storage').writeTempBatch(currentBatch, 'final', 'batch', Date.now());
        }
    }

    async saveResults() {
        // Merge from temp files
        this.results = await require('./storage').mergeTempFiles();

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        if (!fs.existsSync(config.OUTPUT_DIR)) {
            fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
        }

        const jsonPath = path.join(config.OUTPUT_DIR, `results_${timestamp}.json`);
        const csvPath = path.join(config.OUTPUT_DIR, `results_${timestamp}.csv`);

        // Save JSON
        fs.writeFileSync(jsonPath, JSON.stringify(this.results, null, 2));
        logger.info(`Saved JSON results to ${jsonPath}`);

        // Save CSV
        if (this.results.length > 0) {
            const csvWriter = createObjectCsvWriter({
                path: csvPath,
                header: [
                    { id: 'keyword', title: 'Keyword' },
                    { id: 'province', title: 'Province' },
                    { id: 'name', title: 'Name' },
                    { id: 'phones', title: 'Phones' },
                    { id: 'address', title: 'Address' },
                    { id: 'maps_url', title: 'URL' },
                    { id: 'status', title: 'Status' }
                ]
            });

            // Flatten phones for CSV
            const csvData = this.results.map(r => ({
                ...r,
                phones: r.phones.join('; ')
            }));

            await csvWriter.writeRecords(csvData);
            logger.info(`Saved CSV results to ${csvPath}`);
        }
    }
}

module.exports = Controller;
