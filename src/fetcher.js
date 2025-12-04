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

        // Handle Google Consent page
        const currentUrl = page.url();
        if (currentUrl.includes('consent.google.com')) {
            logger.info('Google consent page detected, trying to accept...');
            try {
                // Try to find and click accept button (multiple possible selectors)
                const acceptSelectors = [
                    'button:has-text("Accept all")',
                    'button:has-text("Alle akzeptieren")',
                    'button:has-text("قبول کردن")',
                    'button[aria-label*="Accept"]',
                    'button[aria-label*="Akzeptieren"]',
                    'form[action*="consent"] button[type="submit"]',
                    'button#L2AGLb', // Common Google consent button ID
                    'button[data-ved]',
                    'div[role="dialog"] button:last-child'
                ];
                
                let accepted = false;
                for (const selector of acceptSelectors) {
                    try {
                        const button = await page.$(selector);
                        if (button) {
                            await button.click();
                            await page.waitForTimeout(2000);
                            accepted = true;
                            logger.info(`Clicked consent button with selector: ${selector}`);
                            break;
                        }
                    } catch (e) {
                        // Continue with next selector
                    }
                }
                
                // If button click didn't work, try JavaScript click
                if (!accepted) {
                    const clicked = await page.evaluate(() => {
                        const buttons = document.querySelectorAll('button, [role="button"]');
                        for (const btn of buttons) {
                            const text = btn.innerText || btn.textContent || '';
                            if (text.includes('Accept') || text.includes('Akzeptieren') || text.includes('قبول') || text.includes('Alle')) {
                                btn.click();
                                return true;
                            }
                        }
                        // Try form submit
                        const form = document.querySelector('form[action*="consent"]');
                        if (form) {
                            form.submit();
                            return true;
                        }
                        return false;
                    });
                    
                    if (clicked) {
                        await page.waitForTimeout(3000);
                        logger.info('Clicked consent using JavaScript');
                    } else {
                        logger.warn('Could not find consent button, trying to navigate directly...');
                        // Extract continue URL and navigate directly
                        const continueUrl = await page.evaluate(() => {
                            const urlParams = new URLSearchParams(window.location.search);
                            return urlParams.get('continue');
                        });
                        if (continueUrl) {
                            await page.goto(decodeURIComponent(continueUrl), { waitUntil: 'networkidle2', timeout: config.NAV_TIMEOUT });
                            logger.info('Navigated directly to continue URL');
                        }
                    }
                }
                
                // Wait for redirect to complete
                await page.waitForTimeout(3000);
            } catch (e) {
                logger.warn(`Error handling consent page: ${e.message}`);
            }
        }

        // Wait a bit for page to fully load
        await page.waitForTimeout(3000);

        // Try to wait for any common Google Maps elements first
        try {
            await page.waitForSelector('div[role="main"]', { timeout: 10000 }).catch(() => {});
            await page.waitForTimeout(2000);
        } catch (e) {}

        // Debug: Check what's on the page
        const pageContent = await page.evaluate(() => {
            const allDivs = Array.from(document.querySelectorAll('div')).slice(0, 50);
            const divsWithRole = allDivs.filter(d => d.getAttribute('role')).map(d => ({
                role: d.getAttribute('role'),
                ariaLabel: d.getAttribute('aria-label'),
                className: d.className.substring(0, 50)
            }));
            
            return {
                title: document.title,
                url: window.location.href,
                hasFeed: !!document.querySelector('div[role="feed"]'),
                hasMain: !!document.querySelector('div[role="main"]'),
                feedCount: document.querySelectorAll('div[role="feed"]').length,
                placeLinksCount: document.querySelectorAll('a[href*="/maps/place/"]').length,
                bodyText: document.body.innerText.substring(0, 300),
                divsWithRole: divsWithRole.slice(0, 10)
            };
        }).catch(() => ({}));
        logger.warn(`Page content check: ${JSON.stringify(pageContent, null, 2)}`);
        
        // Take screenshot for debugging (only if feed not found)
        if (!pageContent.hasFeed && pageContent.placeLinksCount === 0) {
            try {
                const screenshotPath = `./output/debug_${Date.now()}_${query.replace(/\s+/g, '_')}.png`;
                await page.screenshot({ path: screenshotPath, fullPage: true });
                logger.warn(`Screenshot saved to ${screenshotPath} for debugging`);
            } catch (e) {
                logger.debug(`Could not take screenshot: ${e.message}`);
            }
        }

        // Wait for feed or alternative containers
        let feedSelector = await waitForAnySelector(
            page,
            selectors.SEARCH.RESULTS_CONTAINER,
            config.SELECTOR_TIMEOUT
        );
        
        // If still not found, try comprehensive search
        if (!feedSelector) {
            logger.debug('Trying comprehensive feed search...');
            const foundSelector = await page.evaluate(() => {
                // Try multiple strategies
                const strategies = [
                    () => {
                        const feed = document.querySelector('div[role="feed"]');
                        if (feed && feed.scrollHeight > 0) return 'div[role="feed"]';
                    },
                    () => {
                        const feeds = document.querySelectorAll('div[aria-label*="Result"], div[aria-label*="نتایج"]');
                        for (const feed of feeds) {
                            if (feed.scrollHeight > 0 && feed.offsetParent !== null) {
                                return 'div[aria-label*="Result"]';
                            }
                        }
                    },
                    () => {
                        // Look for scrollable containers with links
                        const containers = document.querySelectorAll('div[role="main"] > div, div[jsaction]');
                        for (const container of containers) {
                            const links = container.querySelectorAll('a[href*="/maps/place/"]');
                            if (links.length > 0 && container.scrollHeight > 0) {
                                return 'div[role="main"] > div';
                            }
                        }
                    },
                    () => {
                        // Last resort: find any container with place links
                        const allLinks = document.querySelectorAll('a[href*="/maps/place/"]');
                        if (allLinks.length > 0) {
                            const parent = allLinks[0].closest('div[role="feed"], div[aria-label*="Result"], div[aria-label*="نتایج"]');
                            if (parent) return 'div[role="feed"]';
                        }
                    }
                ];
                
                for (const strategy of strategies) {
                    try {
                        const result = strategy();
                        if (result) return result;
                    } catch (e) {}
                }
                return null;
            }).catch(() => null);
            
            if (foundSelector) {
                feedSelector = foundSelector;
                logger.info(`Found feed using comprehensive search: ${feedSelector}`);
            } else {
                logger.warn('Could not find feed using any method. Page might be blocked or have different structure.');
            }
        }

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
            try {
                // Try to find element
                const exists = await page.$(sel);
                if (exists) {
                    // Double check that element is actually visible and has content
                    const isVisible = await page.evaluate((selector) => {
                        const el = document.querySelector(selector);
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        return style.display !== 'none' && 
                               style.visibility !== 'hidden' && 
                               el.offsetParent !== null &&
                               el.scrollHeight > 0;
                    }, sel);
                    if (isVisible) return sel;
                }
            } catch (e) {
                // Continue with next selector
            }
        }
        await page.waitForTimeout(200);
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
        // Scroll to bottom of the *real* scrollable feed container.
        // اگر selector ورودی اشتباه باشد، این تابع سعی می‌کند کانتینر درست را خودش پیدا کند.
        const currentHeight = await page.evaluate((sel) => {
            function isScrollable(container) {
                if (!container) return false;
                const h = container.scrollHeight || 0;
                const ch = container.clientHeight || 0;
                return h > ch + 50; // اختلاف معنی‌دار بین محتوا و ارتفاع قابل‌مشاهده
            }

            // ۱) سعی با selector ورودی
            let el = sel ? document.querySelector(sel) : null;

            // ۲) اگر مناسب نبود، بین کانتینرهای شناخته‌شده بگرد
            if (!isScrollable(el)) {
                const candidates = Array.from(document.querySelectorAll(
                    'div[role="feed"], .m6QErb.DxyBCb.XiKgde, .m6QErb.DxyBCb'
                ));
                el = candidates.find(isScrollable) || el;
            }

            // ۳) اگر باز هم چیزی نیست، تسلیم می‌شویم
            if (!isScrollable(el)) return null;

            // برای دیباگ: با outline قرمز مشخصش می‌کنیم
            el.style.outline = '2px solid #ff0000';
            el.scrollTop = el.scrollHeight;
            return el.scrollHeight;
        }, selector).catch(() => null);

        loops++;

        // Wait for loader to finish and items to load
        await waitForLoaderToFinish(page);

        if (currentHeight == null) {
            logger.warn(`smartScrollFeed: feed element for selector "${selector}" not found on loop ${loops}.`);
            break;
        }

        // Re-check height after waiting for loader
        const heightAfterWait = await page.evaluate((sel) => {
            function isScrollable(container) {
                if (!container) return false;
                const h = container.scrollHeight || 0;
                const ch = container.clientHeight || 0;
                return h > ch + 50;
            }

            let el = sel ? document.querySelector(sel) : null;
            if (!isScrollable(el)) {
                const candidates = Array.from(document.querySelectorAll(
                    'div[role="feed"], .m6QErb.DxyBCb.XiKgde, .m6QErb.DxyBCb'
                ));
                el = candidates.find(isScrollable) || el;
            }

            if (!el) return 0;
            return el.scrollHeight || 0;
        }, selector).catch(() => currentHeight || 0);
        
        if (heightAfterWait === lastHeight) {
            consecutiveNoChange++;
            stableLoops++;

            // اگر ارتفاع چند بار پشت سر هم ثابت ماند، فقط سعی می‌کنیم lazy-load را تحریک کنیم
            // ولی دیگر فقط بر اساس ثابت ماندن ارتفاع، حلقه را قطع نمی‌کنیم.
            if (stableLoops >= config.SCROLL_STABILIZE_LOOPS) {
                logger.debug(`Scroll height stabilized for ${stableLoops} loops. Checking for end-of-list and nudging scroll for lazy-load...`);

                // یک بار دیگر چک می‌کنیم که آیا واقعاً به انتها رسیده‌ایم
                const reachedEndByDivAfterStabilize = await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    if (!el) return false;
                    const txt = el.innerText || '';
                    return txt.includes("You've reached the end of the list") ||
                           txt.includes("به پایان لیست رسیدید") ||
                           txt.includes("لیست تمام شد");
                }, selectors.SEARCH.END_OF_LIST_SELECTOR);

                if (reachedEndByDivAfterStabilize) {
                    logger.info('End of list detected by end-of-list div after stabilization.');
                    break;
                }

                // اگر end-of-list div نبود، یک اسکرول کوچک اضافی برای trigger کردن lazy load
                logger.debug(`No end-of-list div found yet. Height unchanged ${consecutiveNoChange} times. Doing a small up/down scroll to trigger lazy-load...`);
                await page.$eval(selector, el => {
                    el.scrollTop = Math.max(0, el.scrollHeight - 200); // کمی بالا
                    setTimeout(() => {
                        el.scrollTop = el.scrollHeight; // دوباره تا پایین
                    }, 250);
                }).catch(() => {});
                await page.waitForTimeout(900);

                // بعد از نودج، دوباره از صفر شروع می‌کنیم برای پایدار شدن
                stableLoops = 0;
                consecutiveNoChange = 0;
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
