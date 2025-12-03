هدف (یک خطی)

ساختن یک اسکرپر Google Maps که: سریع، قابل‌اعتماد، مقاوم در برابر تغییرات UI، قابل ادامه (resume)، قابل توزیع با Worker Pool، و تولید خروجی پاک (JSON/CSV) برای استان‌ها و کلیدواژه‌های داده‌شده.

طراحی کلی سطح بالا (architecture)

Controller (main): بارگذاری ورودی‌ها، مدیریت queue، orchestration worker pool، ذخیره نهایی.

Fetcher (search-page): باز کردن URL search، اسکرول feed، جمع‌آوری لینک‌ها (linksArray).

Worker (detail-page): دریافت لینک، باز کردن در page ثابت، استخراج نام/شماره/آدرس/metadata، normalization، بازگشت نتیجه.

Storage: temp-per-province JSON (atomic writes)، merger نهایی.

Utils: selectors, phone-normalizer, deep DOM helper (shadow DOM), retry/backoff, captcha-detector, logger.

Config: concurrency, timeouts, user-agent pool, proxy list, rate-limits.

قرارداد داده‌ای (schema خروجی)

هر رکورد (JSON):

{
  "keyword": "قهوه تهران",
  "province": "تهران",
  "place_id": "ChIJ...xyz",
  "maps_url": "https://www.google.com/maps/place/...",
  "name": "کافه سلام",
  "phones": ["+98912xxxxxxx","021xxxxxxx"],
  "raw_phone_strings": ["۰۹۱۲ ...", "+98 21 ..."],
  "address": "تهران، ...",
  "category": "کافه",
  "extraction_source": "button|about|tel_link",
  "timestamp": "2025-12-03T12:34:56Z",
  "status": "ok" // or "no_phone", "blocked", "captcha", "error"
}

پیکربندی مهم (مثال)

CONCURRENCY_SEARCHERS = 2 // تعداد صفحات search همزمان (هرکدوم feed اسکرول می‌کنه)

CONCURRENCY_WORKERS = 5 // تعداد workerهای detail (هر worker یک browserContext یا یک page ثابت)

RETRY_LIMIT = 3

SCROLL_STEP_MS = 1200

SCROLL_STABILIZE_LOOPS = 3

NAV_TIMEOUT = 30_000

SELECTOR_TIMEOUT = 5_000

USER_AGENTS = [...rotating list...]

PROXIES = [...optional...]

الگوریتم کامل — گام‌به‌گام (قابل پیاده‌سازی)
مرحله 0 — آماده‌سازی و اعتبارسنجی ورودی

ورودی‌ها: keywords[], provinces[].

تولید لیست searchQueries[] = for each keyword × for each province => ${keyword} ${province}``.

ایجاد پوشه output/temp/{keyword_slug}_{province_slug}.json و فایل لاگ مخصوص آن.

ایجاد in-memory dedupe set برای place_id/maps_url.

مرحله 1 — راه‌اندازی Puppeteer

puppeteer-extra + puppeteer-extra-plugin-stealth.

launch browser با args: --no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-accelerated-2d-canvas.

global request interception:

abort resourceTypes: image, stylesheet, font, media (در صورت نیاز بعضی فونت‌ها را اجازه بده اگر render باگ داشت).

continue for document, script, xhr, fetch.

Randomize default viewport و userAgent از pool برای هر browserContext/page.

مرحله 2 — Searcher: گرفتن linksArray از search page

برای هر searchQuery اجرا می‌شود (می‌توان چندتا searcher همزمان داشت).

Pseudocode:

async function fetchLinksForQuery(query) {
  const page = await browser.newPage();
  setupRequestInterception(page);
  await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });

  // wait for either feed or fallback
  const feed = await waitForAnySelector(page, [
    'div[role="feed"]',
    'div[aria-label*="Results"]',
    'div[aria-label*="نتایج"]'
  ], SELECTOR_TIMEOUT);

  if (!feed) {
    // fallback: try `https://www.google.com/maps?q=${query}`
    // if still not, return empty with status
  }

  // Smart scroll on feed (use element.scrollTop)
  await smartScrollFeed(page, 'div[role="feed"]' /*or feed selector*/, { stepMs: SCROLL_STEP_MS, stableLoops: SCROLL_STABILIZE_LOOPS });

  // End condition: check for end-of-list text (multi-language) OR stable scroll
  // Extract links
  const links = await page.$$eval('a[href^="https://www.google.com/maps/place/"]', els =>
     els.map(a => ({href: a.href, text: a.innerText, aria: a.getAttribute('aria-label')}))
  );

  await page.close();
  return uniqueFilteredLinks(links);
}


نکات دقیقی که باید رعایت بشه در این مرحله

از element.scrollTop = element.scrollHeight استفاده شود؛ نه window.scrollBy.

شمارش تغییرات scrollHeight برای تشخیص پایان.

timeout زیرمجموعه برای هر scroll loop.

اگر feed وجود نداشت، تلاش کن با q= URL یا با زوم کردن/کلید Enter مجدد صفحه را trigger کنی.

قبل از خروج، فیلتر URLs تکراری و URLs مثل /maps/dir/ را جدا کن (dir ممکنه نیاز باشه یا نه؛ معمولاً place بهترینه).

مرحله 3 — Queue و Worker Pool (Parallel detail extraction)

Controller قرار است linksArray را در یک queue قرار دهد.

Worker pool مصرف‌کننده queue با CONCURRENCY_WORKERS worker.

هر Worker pseudocode:

async function workerLoop() {
  const context = await browser.createIncognitoBrowserContext(); // isolate cookies if using proxies/users
  const page = await context.newPage();
  setupRequestInterception(page);
  setRandomUAandViewport(page);

  while (link = queue.pop()) {
    try {
      await page.goto(link.href, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
      await humanLikePause(page);

      // Wait for name
      const name = await safeText(page, 'h1', 5000);

      // Phone extraction: use multiple strategies
      let phones = await extractPhonesFromDetail(page);

      // If not found, open 'About' or click 'Website' or other tabs
      if (!phones || phones.length === 0) {
         await openAboutTabIfExists(page);
         phones = await extractPhonesFromDetail(page);
      }

      phones = phones.map(normalizePhone).filter(validPhone);

      // get place_id from URL if exists (maps uses /place/.../data=!3m1!4b1!4m5!3m4!1s0x...)
      const place_id = extractPlaceIdFromUrl(page.url());

      // Build record and write to temp buffer
      await writeTempRecord({ keyword, province, place_id, maps_url: page.url(), name, phones, ... });

    } catch (err) {
      handleWorkerError(err, link);
    } finally {
      // small random delay between items to mimic human
      await page.waitForTimeout(200 + Math.random() * 400);
    }
  }

  await page.close();
  await context.close();
}


extractPhonesFromDetail(page) — باید چندین مسیر را امتحان کند:

button[data-item-id^="phone:"] → innerText یا aria-label.

a[href^="tel:"] → href parse.

[aria-label*="Phone"] / [aria-label*="تلفن"].

عنصر‌هایی که آیکون گوشی دارند: img[src*="phone"] یا دکمه‌هایی با tooltip Copy phone number.

چک shadow DOM (deepQuerySelector).

اگر همه ناموفق ← try opening menus: click on "More info" / "About" tab and re-run extract.

مرحله 4 — Normalization و Validation

تبدیل ارقام فارسی به انگلیسی.

حذف فاصله‌ها و کاراکترهای غیرعددی.

Patternها:

^(\+98|0098|0)?9\d{9}$ → موبایل

^0[1-9]\d{8,}$ → ثابت (تست شهر)

Accept +98 and leading 0.

اگر عدد کمتر از 7 digit → discard.

ذخیره‌ی همزمان raw_phone_strings برای رجوع بعدی.

نمونه تابع در JS:

function normalizePhone(s) {
  if (!s) return null;
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  s = s.replace(/[۰-۹]/g, ch => fa.indexOf(ch));
  s = s.replace(/[^\d+]/g,'');
  if (s.startsWith('0098')) s = '+' + s.slice(2);
  if (s.startsWith('0')) s = s; // keep leading 0 if local
  return s;
}

مرحله 5 — Storage امن و resume

هر worker رکوردها را در یک بافر محلی نگه می‌دارد (مثلاً bufferBatch[] تا 50 رکورد).

وقتی بافر پر شد یا بعد از n ثانیه، با atomic write ذخیره کن:

بنویس به temp/{keyword}_{province}_part_{i}.json (یک فایل JSON array).

هنگام merge نهایی، همه فایل‌های part را خوانده و concat کن؛ سپس dedupe بر اساس place_id یا maps_url.

اگر process crash شد، خواندن temp/ و resume از جایی که place_id ثبت نشده است.

نگذار یک فایل JSON بزرگ append شود — چون ممکنه وسط append خراب بشه.

مرحله 6 — Error handling و retry logic

تقسیم‌بندی خطاها:

Transient (network timeout, navigation timeout) → retry exponential backoff up to RETRY_LIMIT.

Selector missing (element not found) → log as no_element and continue.

Block/Captcha → mark status: "captcha" and rotate proxy or pause worker for that IP; notify human.

Hard errors → log stacktrace, mark link as error.

استفاده از circuit-breaker: اگر captcha بیش از N بار پشت سر هم رخ دهد → reduce concurrency, rotate proxy pool.

مرحله 7 — Anti-detection (مهم)

Stealth plugin.

Rotate User-Agent و viewport per context.

Random sleep between actions: 100-800ms between DOM interactions.

Randomized mouse movements and small scrolls.

Reuse page instead of opening/closing زیاد (که واضح‌تر بودن رفتار انسانی را کم می‌کند).

اگر IP بلاک شد → rotate proxy + clear cookies.

Rate limit: برای هر IP محدود به X requests per minute به‌صورت قابل‌تنظیم.

اجازه لود script و xhr؛ فقط resources سنگین را abort کن.

مرحله 8 — Detection of CAPTCHAs / Block

معیارها:

وجود #recaptcha یا iframe[src*="recaptcha"].

صفحه redirect به sorry/index یا پیامی حاوی "unusual traffic" یا "are you a robot".

وقتی تشخیص داده شد:

worker mark کند لینک و context را قرنطینه کند.

rotate proxy یا sleep طولانی‌تر (تنها وقتی proxy available است).

لاگ هشدار و ارسال نوتیف برای اپراتور.

مرحله 9 — Metrics, Logging و Health

هر رکورد لاگ: { timestamp, workerId, action, latencyMs, url, status }.

Aggregations: processed_count, success_rate, phone_found_rate, avg_latency_per_item, captcha_rate.

گزارش هر ساعت به یک فایل metrics.log یا push به Prometheus/Grafana (در مرحله production).

Health endpoint ساده (اگر سرویس قرار است در سرور اجرا شود) که وضعیت pool‌ها و queue length را نشان دهد.

مرحله 10 — Testing و Validation

Unit tests: phone normalization, deepQuerySelector, URL parsing.

Integration tests: چند نمونه keyword/province شناخته‌شده با خروجی قابل‌پیش‌بینی.

Canary runs: اول با concurrency=1 و تعداد اندک province تست کن.

Regression tests بعد از هر تغییر major selector.

لیست کامل Selectorها و fallbackها (اولویت‌بندی شده)

Feed:

div[role="feed"]

div[aria-label*="Results"]

div[aria-label*="نتایج"]

Place links:

a[href^="https://www.google.com/maps/place/"]

a[href*="/place/"] (فیلتر بعدی)

Name:

h1 (معمولاً عنوان)

h2[aria-level="1"]

Phone:

button[data-item-id^="phone:"]

a[href^="tel:"]

[aria-label^="Phone"]

[aria-label^="تلفن"]

img[src*="phone"] → parent text

بررسی shadow DOM با deepQuerySelector

About / More:

button[aria-label*="About"]

button[aria-label*="اطلاعات"]

End-of-list detection:

stable scrollHeight for N loops (primary)

multi-language text: You've reached the end of the list, لیست تمام شد, etc. (secondary)

Checklist تحویل به Cursor AI (کارهایی که باید دقیق پیاده‌سازی بشه)

 پیاده‌سازی smartScrollFeed که روی element.scrollTop کار کند و stabilty check داشته باشد.

 تابع fetchLinksForQuery(query) که fallbackها را مدیریت کند.

 Queue & Worker Pool با امکان تغییر concurrency runtime.

 Worker detail extraction با همه fallbackهای phone extraction و shadow DOM.

 normalizePhone + validation rules (فارسی→انگلیسی).

 Temp file writing per batch و merger نهایی با dedupe.

 Retry/backoff و circuit-breaker و captcha detection.

 Request interception (block images/styles/fonts) با امکان override.

 Randomized UA, viewport, mouse movement utilities.

 Metrics & logging (structured JSON logs).

 Tests: unit + integration + canary.

چند تصمیم مهم که تو پیاده‌سازی باید حتمی بگیری (و چرا)

خروجی نهایی: JSON vs CSV — JSON بهتر برای metadata؛ CSV برای مصرف سریع در Excel. (من هر دو را تولید می‌کنم)

استفاده از پروکسی: اگر هدف حجم بالا است حتماً نیاز به proxies با rotate و health-check.

Session isolation: هر worker در incognito context اجرا شود تا cache/cookie leak نشود.

Retry policy: RETRY_LIMIT=3 و exponential backoff (500ms → 1500ms → 4500ms).

Concurrency پیش‌فرض: Searchers=2, Workers=5 — بعد از canary می‌توان افزایش داد.

مثال نمونه‌ی Pseudocode (کوتاه، قابل تبدیل به Node.js)
// main.js (controller)
for (const query of searchQueries) {
  links = await fetchLinksForQuery(query);
  enqueueLinks(links, { keyword, province });
}

// start workers
for (let i=0;i<CONCURRENCY_WORKERS;i++) startWorker(i);

پایان — خروجی و گام بعدی

من این الگوریتم را کامل، دقیق و آماده پیاده‌سازی نوشتم—تمام موارد عملی، fallbackها، normalization، storage امن، detection و metrics پوشش داده شد.
اگر می‌خواهی، فوراً می‌تونم این طراحی را به:

کد Node.js کامل (فایل‌‌به‌‌فایل، تست‌ها و README)، یا

یک طرح پیاده‌سازی مرحله‌ای (milestone) برای Cursor AI که هر مرحله را اجرا و تست کند.