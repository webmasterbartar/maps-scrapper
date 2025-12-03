// src/config.js

module.exports = {
    // Concurrency settings
    CONCURRENCY_SEARCHERS: 2,
    CONCURRENCY_WORKERS: 5,

    // Navigation & Timeout settings
    NAV_TIMEOUT: 20000, // کاهش برای جلوگیری از گیر کردن
    SELECTOR_TIMEOUT: 3000, // کاهش برای سریع‌تر گذشتن
    // When false we launch Chrome with a visible window to watch the scraper
    // Headless mode is FASTER and MORE RELIABLE - keep it true for production
    HEADLESS: false, // خاموش برای مشاهده UI و دیباگ
    
    // Scroll settings
    // How long to wait between scroll steps (ms) – کمتر = سریع‌تر
    SCROLL_STEP_MS: 150, // کاهش شدید برای سریع‌تر اسکرول
    // چند بار ارتفاع ثابت بماند تا اگر end-of-list div نبود، حلقه را متوقف کنیم
    SCROLL_STABILIZE_LOOPS: 2, // کاهش برای سریع‌تر توقف
    // سقف مطلق تعداد اسکرول برای جلوگیری از لوپ بی‌نهایت (مقدار بالاتر پوشش بیشتر)
    MAX_SCROLL_LOOPS: 50, // کاهش برای سریع‌تر

    // Map panning settings (to cover more businesses by moving the viewport)
    // کاهش برای سرعت بیشتر
    PANNING_STEPS: 2, // کاهش از 4 به 2 برای سرعت بیشتر
    // Pixel distance per pan move
    PANNING_PIXEL_DELTA: 300,

    // Retry logic
    RETRY_LIMIT: 5, // افزایش برای قطع اینترنت
    RETRY_DELAY_BASE: 2000, // 2 ثانیه پایه برای قطع اینترنت
    RETRY_DELAY_MAX: 60000, // حداکثر 60 ثانیه انتظار
    NETWORK_RETRY_DELAY: 10000, // 10 ثانیه برای خطاهای شبکه
    
    // Complete list of Iran provinces
    IRAN_PROVINCES: [
        'تهران', 'البرز', 'قم', 'قزوین', 'گیلان', 'مازندران', 'گلستان',
        'خراسان رضوی', 'خراسان شمالی', 'خراسان جنوبی',
        'آذربایجان شرقی', 'آذربایجان غربی', 'اردبیل',
        'اصفهان', 'کرمان', 'کرمانشاه', 'خوزستان', 'بوشهر', 'هرمزگان',
        'سیستان و بلوچستان', 'یزد', 'مرکزی', 'زنجان', 'همدان', 'کردستان',
        'لرستان', 'چهارمحال و بختیاری', 'کهگیلویه و بویراحمد', 'فارس', 'ایلام', 'سمنان'
    ],

    // Output settings
    OUTPUT_DIR: './output',
    TEMP_DIR: './output/temp',

    // User Agents Pool (simplified for now, can be expanded)
    USER_AGENTS: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
    ],

    // Proxies (Placeholder - to be filled by user or loaded from file)
    PROXIES: [],
    
    // Rate Limiting
    REQUESTS_PER_MINUTE: 60,
};
