# Google Maps Scraper

یک اسکرپر قدرتمند برای استخراج اطلاعات کسب‌وکارها از Google Maps با قابلیت‌های پیشرفته.

## ویژگی‌ها

- ✅ استخراج اطلاعات کامل (نام، تلفن، آدرس، URL)
- ✅ پشتیبانی از تمام استان‌های ایران
- ✅ اسکرول هوشمند برای دریافت همه نتایج
- ✅ Panning خودکار نقشه برای پوشش بیشتر
- ✅ مقاوم در برابر قطع اینترنت (retry با exponential backoff)
- ✅ پردازش موازی برای سرعت بیشتر
- ✅ ذخیره‌سازی موقت و merge خودکار
- ✅ خروجی JSON و CSV

## نصب

```bash
npm install
```

## استفاده

### مثال ساده:
```bash
node src/index.js --keywords="کافه" --provinces="تهران"
```

### با چند کلمه کلیدی:
```bash
node src/index.js --keywords="کافه,رستوران" --provinces="تهران,اصفهان"
```

### با همه استان‌های ایران:
```bash
node src/index.js --keywords="کافه"
```

## پارامترهای CLI

- `--keywords`: کلمات کلیدی جستجو (جدا شده با کاما)
- `--provinces`: استان‌ها (جدا شده با کاما). اگر مشخص نشود، همه استان‌های ایران استفاده می‌شود.

## تنظیمات

فایل `src/config.js` شامل تمام تنظیمات قابل تغییر است:

- `HEADLESS`: حالت headless (true/false)
- `SCROLL_STEP_MS`: زمان انتظار بین اسکرول‌ها
- `MAX_SCROLL_LOOPS`: حداکثر تعداد اسکرول
- `PANNING_STEPS`: تعداد مراحل panning نقشه
- `CONCURRENCY_WORKERS`: تعداد worker های موازی

## خروجی

نتایج در پوشه `output/` ذخیره می‌شوند:
- `results_TIMESTAMP.json`: خروجی JSON
- `results_TIMESTAMP.csv`: خروجی CSV

## وابستگی‌ها

- `puppeteer-extra`: اتوماسیون مرورگر
- `puppeteer-extra-plugin-stealth`: جلوگیری از تشخیص
- `csv-writer`: نوشتن فایل CSV
- `winston`: لاگینگ

## مجوز

MIT

