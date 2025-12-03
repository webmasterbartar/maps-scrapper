// src/utils/selectors.js

module.exports = {
    SEARCH: {
        FEED: 'div[role="feed"]',
        RESULTS_CONTAINER: [
            'div[role="feed"]',
            'div[aria-label*="Results"]',
            'div[aria-label*="نتایج"]',
            'div[jsaction*="pane.resultContainer"]',
            '[role="main"] div[role="feed"]',
            'div[data-value="Directions"]', // Fallback
            'div.m6QErb.DxyBCb.XiKgde' // Alternative container
        ],
        // Multiple selectors to catch all place links
        PLACE_LINK: [
            'a[href^="https://www.google.com/maps/place/"]',
            'a[href*="/maps/place/"]',
            'a[data-value*="place"]',
            '[role="link"][href*="/maps/place/"]'
        ],
        // End-of-list detection
        END_OF_LIST_TEXT: [
            "You've reached the end of the list",
            "به پایان لیست رسیدید",
            "لیست تمام شد"
        ],
        END_OF_LIST_SELECTOR: 'div.m6QErb.XiKgde.tLjsW.eKbjU .HlvSq'
    },
    DETAIL: {
        NAME: 'h1',
        PHONE_BUTTON: 'button[data-item-id^="phone:"]',
        PHONE_LINK: 'a[href^="tel:"]',
        ADDRESS_BUTTON: 'button[data-item-id="address"]',
        WEBSITE_BUTTON: 'a[data-item-id="authority"]',
        ABOUT_TAB: 'button[aria-label*="About"]', // Adjust based on language
        ABOUT_TAB_FA: 'button[aria-label*="اطلاعات"]',

        // Fallback selectors
        ARIA_PHONE: '[aria-label*="Phone"]',
        ARIA_PHONE_FA: '[aria-label*="تلفن"]',
        IMG_PHONE: 'img[src*="phone"]'
    }
};
