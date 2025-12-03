# راهنمای نصب و اجرا روی سرور

## مراحل نصب

### 1. اتصال به سرور
```bash
ssh root@82.115.20.113
# Password: NUx72Zm4kppkkwxi
```

### 2. اجرای اسکریپت نصب
```bash
# Clone repository
git clone https://github.com/webmasterbartar/maps-scrapper.git
cd maps-scrapper

# یا اگر قبلاً clone کرده‌اید:
cd maps-scrapper
git pull origin main

# اجرای اسکریپت نصب
chmod +x deploy.sh
./deploy.sh
```

### 3. اجرای اسکرپر

#### روش 1: اجرای ساده (در foreground)
```bash
./run.sh
```

#### روش 2: اجرای در background (پیشنهادی برای سرور)
```bash
chmod +x start-scraper.sh
./start-scraper.sh
```

این روش:
- برنامه را در background اجرا می‌کند
- با قطع SSH ادامه می‌دهد
- لاگ‌ها را در `logs/` ذخیره می‌کند
- PID را در `scraper.pid` ذخیره می‌کند

#### مشاهده لاگ‌ها
```bash
# مشاهده لاگ زنده
tail -f logs/scraper_*.log

# یا آخرین لاگ
tail -f logs/$(ls -t logs/ | head -1)
```

#### توقف اسکرپر
```bash
chmod +x stop-scraper.sh
./stop-scraper.sh
```

### 4. اجرای با پارامترهای سفارشی

```bash
# فقط یک شهر
node src/index.js --keywords="کافه" --provinces="تهران"

# چند شهر
node src/index.js --keywords="کافه" --provinces="تهران,اصفهان,کرج"

# چند کلمه کلیدی
node src/index.js --keywords="کافه,رستوران" --provinces="تهران"
```

## بررسی وضعیت

```bash
# بررسی اینکه آیا در حال اجرا است
ps aux | grep "node src/index.js"

# بررسی PID
cat scraper.pid

# بررسی آخرین لاگ
tail -20 logs/$(ls -t logs/ | head -1)
```

## نکات مهم

1. **Headless Mode**: در `src/config.js` باید `HEADLESS: true` باشد (برای سرور)
2. **فضای دیسک**: مطمئن شوید فضای کافی برای خروجی‌ها دارید
3. **RAM**: Puppeteer به حداقل 2GB RAM نیاز دارد
4. **اینترنت**: اطمینان حاصل کنید که سرور به اینترنت دسترسی دارد

## مدیریت با PM2 (اختیاری - برای اجرای پایدارتر)

```bash
# نصب PM2
npm install -g pm2

# اجرا با PM2
pm2 start src/index.js --name maps-scraper -- --keywords="کافه"

# مشاهده لاگ
pm2 logs maps-scraper

# توقف
pm2 stop maps-scraper

# راه‌اندازی مجدد
pm2 restart maps-scraper
```

