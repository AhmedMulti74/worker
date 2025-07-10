// src/parse.ts
import * as cheerio from 'cheerio';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const INPUT_FILE = join('output', 'scraped_page.html');
const OUTPUT_FILE = join('output', 'extracted_text.txt');

// TypeScript يستنتج أن هذه الدالة تعيد Promise<string>
export async function extractText() {
    console.log(`--- Stage 2: Starting text extraction ---`);
    try {
        const htmlContent = await readFile(INPUT_FILE, 'utf-8');
        const $ = cheerio.load(htmlContent);
        $('script, style, noscript, link, meta, head, footer, nav').remove();
        const allText = $('body').text();
        const cleanedText = allText.replace(/\s\s+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
        await writeFile(OUTPUT_FILE, cleanedText);
        console.log(`✅ Success: Text extracted.`);
        return cleanedText;
    } catch (error: any) { // أضف نوعًا للخطأ
        console.error('❌ Failed in Stage 2 (Text Extraction):', error.message);
        throw error;
    }
}