// src/utils/robustness.js
const logger = require('./logger');

/**
 * Sleep for a random amount of time between min and max ms.
 * @param {number} min 
 * @param {number} max 
 */
async function randomSleep(min, max) {
    const ms = Math.floor(Math.random() * (max - min + 1) + min);
    await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Checks for common Captcha indicators on the page.
 * @param {import('puppeteer').Page} page 
 * @returns {Promise<boolean>} True if captcha detected
 */
async function checkCaptcha(page) {
    try {
        const title = await page.title();
        if (title.includes('Sorry') || title.includes('Robot') || title.includes('Unusual traffic')) {
            return true;
        }

        const captchaFrame = await page.$('iframe[src*="recaptcha"]');
        if (captchaFrame) return true;

        const captchaDiv = await page.$('#recaptcha');
        if (captchaDiv) return true;

        return false;
    } catch (e) {
        return false;
    }
}

/**
 * Checks if an error is a network-related error (internet disconnection, timeout, etc.)
 * @param {Error} error 
 * @returns {boolean}
 */
function isNetworkError(error) {
    const msg = (error.message || '').toLowerCase();
    const networkKeywords = [
        'net::err', 'network', 'timeout', 'econnreset', 'econnrefused',
        'enotfound', 'etimedout', 'socket', 'connection', 'disconnected',
        'failed to fetch', 'navigation timeout', 'target closed'
    ];
    return networkKeywords.some(keyword => msg.includes(keyword));
}

/**
 * Retries a function with exponential backoff.
 * Special handling for network errors (longer waits).
 * @param {Function} fn - Async function to retry
 * @param {number} retries - Max retries
 * @param {number} delay - Base delay in ms
 * @param {number} maxDelay - Maximum delay in ms
 */
async function retry(fn, retries = 3, delay = 1000, maxDelay = 30000) {
    const config = require('../config');
    const baseDelay = delay || config.RETRY_DELAY_BASE || 2000;
    const maxRetries = retries || config.RETRY_LIMIT || 5;
    const maxWait = maxDelay || config.RETRY_DELAY_MAX || 60000;
    const networkDelay = config.NETWORK_RETRY_DELAY || 10000;

    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === maxRetries - 1) {
                logger.error(`All ${maxRetries} retries exhausted. Last error: ${error.message}`);
                throw error;
            }

            const isNetwork = isNetworkError(error);
            const waitTime = isNetwork 
                ? Math.min(networkDelay * (i + 1), maxWait) // برای قطع اینترنت، wait طولانی‌تر
                : Math.min(baseDelay * Math.pow(2, i), maxWait); // exponential backoff عادی

            logger.warn(
                `Retry ${i + 1}/${maxRetries} failed: ${error.message}. ` +
                `${isNetwork ? '(Network error - longer wait)' : ''} Waiting ${waitTime}ms...`
            );
            
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

module.exports = {
    randomSleep,
    checkCaptcha,
    retry,
    isNetworkError
};
