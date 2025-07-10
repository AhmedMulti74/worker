// src/scraper.ts

import { PlaywrightCrawler, Configuration, log, LogLevel } from 'crawlee';
import type { Page } from 'playwright';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// إيقاف طباعة سجلات crawlee الكثيرة في الطرفية
log.setLevel(LogLevel.WARNING);

const OUTPUT_DIR = "output";


export async function scrapePage(url: string): Promise<string> {
    console.log(`--- Stage 1 (Crawlee): Starting HTML scrape for: ${url} ---`);
    
    // متغير لتخزين HTML الذي سنحصل عليه
    let scrapedHtml: string | null = null;
    let scrapeError: Error | null = null;

    const stealth = stealthPlugin();

    const crawler = new PlaywrightCrawler({
        maxRequestRetries: 2, // إعادة المحاولة مرتين عند فشل الشبكة
        navigationTimeoutSecs: 120, // مهلة 2 دقيقة للملاحة
        launchContext: {
            launchOptions: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        },
        preNavigationHooks: [
            async ({ page }: { page: Page }) => {
                // تطبيق حيل التخفي على الصفحة
                await stealth.onPageCreated(page as any);
            },
        ],
        // requestHandler سيتم استدعاؤه مرة واحدة فقط للرابط الذي نمرره
        requestHandler: async ({ page }) => {
            console.log("Page loaded. Waiting for stability...");
            // انتظار إضافي بسيط
            await page.waitForTimeout(5000); 

            console.log("Page seems stable. Getting final HTML content...");
            const html = await page.content();
            
            if (html.length < 2000) {
                throw new Error(`Potential block page detected. HTML size is only ${html.length} bytes.`);
            }
            
            // تخزين الـ HTML في المتغير الخارجي
            scrapedHtml = html;
        },
        failedRequestHandler: async ({ request }) => {
            // تخزين الخطأ في المتغير الخارجي
            scrapeError = new Error(`Crawling failed for ${request.url} after ${request.retryCount} retries.`);
        },
    });

    // تشغيل الزاحف للرابط المحدد فقط
    await crawler.run([url]);

    // بعد انتهاء الزاحف، تحقق مما إذا كنا قد حصلنا على HTML
    if (scrapeError) {
        throw scrapeError; // رمي الخطأ الذي تم التقاطه
    }

    if (scrapedHtml) {
        // (اختياري) حفظ الملف محليًا للتصحيح
        if (process.env.NODE_ENV !== 'production') {
            await mkdir(OUTPUT_DIR, { recursive: true });
            const outputFile = join(OUTPUT_DIR, `${new URL(url).hostname}.html`);
            await writeFile(outputFile, scrapedHtml);
            console.log(`✅ (Dev only) HTML for ${url} saved locally.`);
        }
        console.log(`✅ Success: HTML content scraped via Crawlee.`);
        return scrapedHtml;
    }

    // حالة طارئة إذا لم يتم تعيين HTML أو خطأ
    throw new Error('Scraping finished without extracting HTML or throwing an error.');
}