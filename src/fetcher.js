// src/fetcher.js
const config = require('./config');
const { setupRequestInterception, setRandomContext } = require('./utils/browser');
const selectors = require('./utils/selectors');
const logger = require('./utils/logger');

/**
 * Scrapes the search results page for a given query.
 * @param {import('puppeteer').Browser} browser 
 * @param {string} query 
 * @returns {Promise<Array<{href: string, text: string, aria?: string}>>}
 */
async function fetchLinksForQuery(browser, query) {
    const page = await browser.newPage();
    try {
        await setupRequestInterception(page);
        await setRandomContext(page);

        const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
        logger.info(`Navigating to search: ${query}`, { url });

        // استفاده از retry برای navigation (مخصوصاً برای قطع اینترنت)
        const { retry } = require('./utils/robustness');
        await retry(
            async () => {
                await page.goto(url, { waitUntil: 'networkidle2', timeout: config.NAV_TIMEOUT });
            },
            config.RETRY_LIMIT,
            config.RETRY_DELAY_BASE,
            config.RETRY_DELAY_MAX
        );

        // Wait a bit for page to fully load
        await page.waitForTimeout(2000);

        // Wait for feed or alternative containers
        let feedSelector = await waitForAnySelector(
            page,
            selectors.SEARCH.RESULTS_CONTAINER,
            config.SELECTOR_TIMEOUT
        );

        // Fallback: try q= URL if no feed detected
        if (!feedSelector) {
            const fallbackUrl = `https://www.google.com/maps?q=${encodeURIComponent(query)}`;
            logger.warn(`Feed not found for ${query}, trying fallback URL`, { fallbackUrl });
            await page.goto(fallbackUrl, { waitUntil: 'networkidle2', timeout: config.NAV_TIMEOUT });
            
            // Wait a bit for page to fully load
            await page.waitForTimeout(2000);

            feedSelector = await waitForAnySelector(
                page,
                selectors.SEARCH.RESULTS_CONTAINER,
                config.SELECTOR_TIMEOUT
            );

            if (!feedSelector) {
                logger.warn(`No feed found for ${query} after fallback. Trying one more time...`);
                // Last attempt: wait a bit more and try again
                await page.waitForTimeout(3000);
                feedSelector = await waitForAnySelector(
                    page,
                    selectors.SEARCH.RESULTS_CONTAINER,
                    config.SELECTOR_TIMEOUT
                );
                
                if (!feedSelector) {
                    logger.warn(`No feed found for ${query} after all attempts.`);
                    return [];
                }
            }
        }

        // Smart Scroll (on feed element scrollTop, not window)
        await smartScrollFeed(page, feedSelector);

        // Wait a bit more for all items to fully render after scroll
        await page.waitForTimeout(500); // کاهش شدید برای سریع‌تر

        // Extract Links from INSIDE the feed element (not just viewport)
        // این مهم است چون باید همه لینک‌ها را از داخل feed بگیریم، نه فقط visible ones
        let links = await page.evaluate((feedSel, linkSelectors) => {
            const feed = document.querySelector(feedSel);
            if (!feed) return [];
            
            const uniqueLinks = new Map();
            
            // Try all selectors to find all possible links
            linkSelectors.forEach(selector => {
                try {
                    const allLinks = feed.querySelectorAll(selector);
                    allLinks.forEach(a => {
                        const href = a.href || a.getAttribute('href');
                        if (href && href.includes('/maps/place/')) {
                            // Normalize href (remove query params for dedupe)
                            const normalizedHref = href.split('?')[0].split('#')[0];
                            if (!uniqueLinks.has(normalizedHref)) {
                                uniqueLinks.set(normalizedHref, {
                                    href: href, // Keep original href with params
                                    text: (a.innerText || a.textContent || a.getAttribute('aria-label') || '').trim(),
                                    aria: a.getAttribute('aria-label') || ''
                                });
                            }
                        }
                    });
                } catch (e) {
                    // Continue with next selector if this one fails
                }
            });
            
            return Array.from(uniqueLinks.values());
        }, feedSelector, Array.isArray(selectors.SEARCH.PLACE_LINK) ? selectors.SEARCH.PLACE_LINK : [selectors.SEARCH.PLACE_LINK]);
        
        logger.info(`Extracted ${links.length} links from feed after scroll`);

        // Optionally pan the map in multiple directions to discover more results
        if (config.PANNING_STEPS && config.PANNING_STEPS > 0) {
            links = await panMapAndCollect(page, feedSelector, links, config.PANNING_STEPS);
        }

        const finalLinks = uniqueFilteredLinks(links);
        logger.info(`Found ${finalLinks.length} unique links for ${query}`);
        return finalLinks;

    } catch (error) {
        logger.error(`Error fetching links for ${query}: ${error.message}`);
        return [];
    } finally {
        await page.close();
    }
}

/**
 * Waits for any selector in the list to appear and returns the one that matched.
 * @param {import('puppeteer').Page} page
 * @param {string[]} selectorList
 * @param {number} timeout
 * @returns {Promise<string|null>}
 */
async function waitForAnySelector(page, selectorList, timeout) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
        for (const sel of selectorList) {
            const exists = await page.$(sel);
            if (exists) return sel;
        }
        await page.waitForTimeout(150);
    }

    return null;
}

/**
 * Waits for loading indicators to disappear and items to load
 */
async function waitForLoaderToFinish(page) {
    // Wait for common loading indicators to disappear
    try {
        // Check if there's a loader visible
        const hasLoader = await page.evaluate(() => {
            const loaders = document.querySelectorAll(
                '[role="progressbar"], .loading, [aria-busy="true"], ' +
                '[class*="loading"], [class*="spinner"], [class*="loader"]'
            );
            return Array.from(loaders).some(el => {
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent;
            });
        });
        
        if (hasLoader) {
            logger.debug('Loader detected, waiting for it to finish...');
            // Wait for loader to disappear
            await page.waitForFunction(() => {
                const loaders = document.querySelectorAll(
                    '[role="progressbar"], .loading, [aria-busy="true"], ' +
                    '[class*="loading"], [class*="spinner"], [class*="loader"]'
                );
                return Array.from(loaders).every(el => {
                    const style = window.getComputedStyle(el);
                    return style.display === 'none' || style.visibility === 'hidden' || !el.offsetParent;
                });
            }, { timeout: 3000 }).catch(() => {
                logger.debug('Loader wait timeout, continuing...');
            });
        }
        
        // Also wait a bit for items to render after loader disappears
        await page.waitForTimeout(500); // کاهش برای سریع‌تر
    } catch (e) {
        // Continue if wait fails
        await page.waitForTimeout(400); // کاهش برای سریع‌تر
    }
}

async function smartScrollFeed(page, selector) {
    let lastHeight = 0;
    let stableLoops = 0;
    let loops = 0;
    let consecutiveNoChange = 0;

    logger.info(`Starting smartScrollFeed on selector: ${selector}`);

    while (loops < (config.MAX_SCROLL_LOOPS || 80)) {
        // Scroll to bottom of the feed element using element.scrollTop.
        // همچنین با border موقت دور فید، آن را در UI برجسته می‌کنیم (فقط برای دیباگ، بی‌ضرر است).
        const currentHeight = await page.$eval(selector, el => {
            el.scrollTop = el.scrollHeight;
            el.style.outline = '2px solid #ff0000';
            return el.scrollHeight;
        }).catch(() => null);

        loops++;

        // Wait for loader to finish and items to load
        await waitForLoaderToFinish(page);

        if (currentHeight == null) {
            logger.warn(`smartScrollFeed: feed element for selector "${selector}" not found on loop ${loops}.`);
            break;
        }

        // Re-check height after waiting for loader
        const heightAfterWait = await page.$eval(selector, el => el.scrollHeight).catch(() => currentHeight);
        
        if (heightAfterWait === lastHeight) {
            consecutiveNoChange++;
            stableLoops++;
            
            // اگر ارتفاع چند بار پشت سر هم ثابت ماند، بررسی می‌کنیم
            if (stableLoops >= config.SCROLL_STABILIZE_LOOPS) {
                logger.debug(`Scroll height stabilized for ${stableLoops} loops. Checking for end-of-list...`);
                
                // یک بار دیگر چک می‌کنیم که آیا واقعاً به انتها رسیده‌ایم
                const reachedEndByDiv = await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    if (!el) return false;
                    const txt = el.innerText || '';
                    return txt.includes("You've reached the end of the list") ||
                           txt.includes("به پایان لیست رسیدید") ||
                           txt.includes("لیست تمام شد");
                }, selectors.SEARCH.END_OF_LIST_SELECTOR);
                
                if (!reachedEndByDiv) {
                    // اگر end-of-list div نبود و ارتفاع هم تغییر نکرده، یک بار دیگر اسکرول می‌کنیم
                    if (consecutiveNoChange < 5) {
                        logger.debug(`No end-of-list div found yet. Height unchanged ${consecutiveNoChange} times. Trying one more scroll...`);
                        // یک اسکرول کوچک اضافی برای trigger کردن lazy load
                        await page.$eval(selector, el => {
                            el.scrollTop = el.scrollHeight - 100; // Scroll up a bit
                            setTimeout(() => {
                                el.scrollTop = el.scrollHeight; // Then scroll to bottom
                            }, 200);
                        }).catch(() => {});
                        await page.waitForTimeout(800); // کاهش برای سریع‌تر
                        stableLoops = 0; // Reset و ادامه می‌دهیم
                        consecutiveNoChange = 0;
                    } else {
                        logger.info('Height unchanged for too long, assuming end of list.');
                        break;
                    }
                } else {
                    logger.info('End of list detected by end-of-list div after stabilization.');
                    break;
                }
            }
        } else {
            stableLoops = 0;
            consecutiveNoChange = 0;
            lastHeight = heightAfterWait;
        }

        // Check for explicit end-of-list div (most reliable) - در هر iteration
        const reachedEndByDiv = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            const txt = el.innerText || '';
            return txt.includes("You've reached the end of the list") ||
                   txt.includes("به پایان لیست رسیدید") ||
                   txt.includes("لیست تمام شد");
        }, selectors.SEARCH.END_OF_LIST_SELECTOR);

        if (reachedEndByDiv) {
            logger.info('End of list detected by end-of-list div.');
            break;
        }

        // Fallback: Check for "End of list" text (multi-language) anywhere in page
        const isEndOfList = await page.evaluate((texts) => {
            const bodyText = document.body.innerText || '';
            return texts.some(t => bodyText.includes(t));
        }, selectors.SEARCH.END_OF_LIST_TEXT);

        if (isEndOfList) {
            logger.info('End of list detected by text.');
            break;
        }

        // Log progress every 5 loops or when height changes
        if (loops % 5 === 0 || heightAfterWait !== lastHeight) {
            logger.debug(`smartScrollFeed loop=${loops} height=${heightAfterWait} stableLoops=${stableLoops} noChange=${consecutiveNoChange}`);
        }
        
        // Wait before next scroll iteration
        await page.waitForTimeout(config.SCROLL_STEP_MS);
    }
}

/**
 * Pans the map viewport in several directions and aggregates links.
 * This helps to discover businesses that are outside the initial list.
 * @param {import('puppeteer').Page} page
 * @param {string} feedSelector
 * @param {Array} initialLinks
 * @param {number} steps
 * @returns {Promise<Array>}
 */
async function panMapAndCollect(page, feedSelector, initialLinks, steps) {
    const allLinks = [...initialLinks];

    const directions = [
        { dx: 0, dy: -1 }, // up
        { dx: 1, dy: 0 },  // right
        { dx: 0, dy: 1 },  // down
        { dx: -1, dy: 0 }  // left
    ];

    const mapHandle = await page.$('canvas[aria-label*="Map"], canvas[role="presentation"], canvas');
    if (!mapHandle) {
        logger.warn('Map canvas not found, skipping panning.');
        return allLinks;
    }

    const box = await mapHandle.boundingBox();
    if (!box) {
        logger.warn('Map canvas has no bounding box, skipping panning.');
        return allLinks;
    }

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    for (let i = 0; i < steps; i++) {
        const dir = directions[i % directions.length];
        const delta = config.PANNING_PIXEL_DELTA || 300;

        try {
            await page.mouse.move(centerX, centerY);
            await page.mouse.down();
            await page.mouse.move(centerX + dir.dx * delta, centerY + dir.dy * delta, { steps: 20 });
            await page.mouse.up();

                   // Wait for map to settle and results to refresh
                   await page.waitForTimeout(800); // کاهش شدید برای سریع‌تر
            
            // Wait for feed to update - check if new items are loading
            let feedUpdated = false;
            for (let waitAttempt = 0; waitAttempt < 3; waitAttempt++) { // کاهش از 5 به 3
                const linkCount = await page.evaluate((feedSel, linkSelectors) => {
                    const feed = document.querySelector(feedSel);
                    if (!feed) return 0;
                    let count = 0;
                    const selectors = Array.isArray(linkSelectors) ? linkSelectors : [linkSelectors];
                    selectors.forEach(sel => {
                        try {
                            count += feed.querySelectorAll(sel).length;
                        } catch (e) {}
                    });
                    return count;
                }, feedSelector, Array.isArray(selectors.SEARCH.PLACE_LINK) ? selectors.SEARCH.PLACE_LINK : [selectors.SEARCH.PLACE_LINK]).catch(() => 0);
                if (linkCount > 0) {
                    feedUpdated = true;
                    logger.debug(`Feed updated after pan step ${i + 1}, found ${linkCount} links`);
                    break;
                }
                       await page.waitForTimeout(300);
            }
            
            if (!feedUpdated) {
                logger.warn(`Feed did not update after pan step ${i + 1}, continuing anyway...`);
            }
            
            // Re-scroll feed in new viewport - باید کامل اسکرول شود
            logger.debug(`Re-scrolling feed after pan step ${i + 1}`);
            await smartScrollFeed(page, feedSelector);

            // Extract links from INSIDE the feed element after panning
            const newLinks = await page.evaluate((feedSel, linkSelectors) => {
                const feed = document.querySelector(feedSel);
                if (!feed) return [];
                
                const uniqueLinks = new Map();
                
                // Try all selectors to find all possible links
                linkSelectors.forEach(selector => {
                    try {
                        const allLinks = feed.querySelectorAll(selector);
                        allLinks.forEach(a => {
                            const href = a.href || a.getAttribute('href');
                            if (href && href.includes('/maps/place/')) {
                                // Normalize href for dedupe
                                const normalizedHref = href.split('?')[0].split('#')[0];
                                if (!uniqueLinks.has(normalizedHref)) {
                                    uniqueLinks.set(normalizedHref, {
                                        href: href,
                                        text: (a.innerText || a.textContent || a.getAttribute('aria-label') || '').trim(),
                                        aria: a.getAttribute('aria-label') || ''
                                    });
                                }
                            }
                        });
                    } catch (e) {
                        // Continue with next selector
                    }
                });
                
                return Array.from(uniqueLinks.values());
            }, feedSelector, Array.isArray(selectors.SEARCH.PLACE_LINK) ? selectors.SEARCH.PLACE_LINK : [selectors.SEARCH.PLACE_LINK]);

            allLinks.push(...newLinks);
            logger.info(`Panning step ${i + 1}/${steps} added ${newLinks.length} links (total so far: ${allLinks.length})`);
        } catch (e) {
            logger.warn(`Panning step ${i + 1} failed: ${e.message}`);
        }
    }

    return allLinks;
}

/**
 * Deduplicates and filters links.
 * @param {Array} links 
 */
function uniqueFilteredLinks(links) {
    const unique = new Map();
    links.forEach(link => {
        // Basic filtering
        if (link.href && link.href.includes('/maps/place/')) {
            // Use href as key for dedupe
            // Can refine to use place_id if extracted
            unique.set(link.href, link);
        }
    });
    return Array.from(unique.values());
}

module.exports = { fetchLinksForQuery };
