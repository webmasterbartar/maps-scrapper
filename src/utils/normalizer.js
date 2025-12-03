// src/utils/normalizer.js

/**
 * Normalizes a phone number string.
 * Handles Persian digits, removes non-numeric characters, and formats to standard format.
 * @param {string} s - The raw phone string.
 * @returns {string|null} - Normalized phone number or null if invalid.
 */
function normalizePhone(s) {
    if (!s) return null;

    // Convert Persian digits to English
    const fa = '۰۱۲۳۴۵۶۷۸۹';
    s = s.replace(/[۰-۹]/g, ch => fa.indexOf(ch));

    // Remove all non-digit and non-plus characters
    s = s.replace(/[^\d+]/g, '');

    // Handle international format
    if (s.startsWith('0098')) {
        s = '+' + s.slice(2);
    } else if (s.startsWith('09')) {
        // Assume Iran mobile if starts with 09
        s = '+98' + s.slice(1);
    } else if (s.startsWith('0')) {
        // Keep leading zero for landlines if not internationalized, 
        // or optionally add +98 if we are sure it's Iran.
        // For now, let's keep it as is or standardize to +98 if needed.
        // User requested: "Accept +98 and leading 0."
    }

    // Basic validation
    if (s.length < 7) return null;

    return s;
}

/**
 * Cleans up text by removing extra whitespace.
 * @param {string} text 
 * @returns {string}
 */
function cleanText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
}

module.exports = {
    normalizePhone,
    cleanText
};
