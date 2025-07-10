// src/extract_plans.ts

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import dotenv from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExtractedPlan } from './types.js'; // استيراد نوع الخطة من ملف الأنواع المركزي

// تحميل متغيرات البيئة (API Key) من ملف .env
dotenv.config();

// تهيئة Gemini API مع التأكيد لـ TypeScript أن المفتاح موجود
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);


export async function analyzeTextWithAI(textContent: string): Promise<ExtractedPlan[]> {
    console.log(`--- Stage 3 (Gemini): Starting AI text analysis ---`);
    try {
        // اختر النموذج - gemini-1.5-flash سريع واقتصادي
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash",
            // إعدادات أمان لتجنب حظر الردود التي قد تحتوي على مصطلحات تسعير
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ]
        });
        
        const prompt = `
            You are an expert data extraction bot. Your task is to analyze text from a website's pricing page and structure the information into a valid JSON object.

            Analyze the following text and identify any pricing plan or plans mentioned. A page might have one or more plans.

            For EACH plan found, extract the following details:
            1. "planName": The name of the plan (e.g., "Free", "Pro", "Business"). If there's no explicit name, infer a suitable name like "Standard Plan".
            2. "price": The numerical price. Use 0 if it's free. Use null if it's a "Contact Us" or custom plan.
            3. "currency": The 3-letter currency code (e.g., "USD", "EUR"). Default to "USD" if not found.
            4. "billingCycle": Must be one of: "monthly", "annually", or "one_time".
            5. "description": A short, one-sentence description of the plan's target audience.
            6. "features": An array of strings listing the key features.

            Your entire response MUST be a single, valid JSON object containing one key, "plans", which is an array of the extracted plan objects.
            If you find only one plan, the array should contain a single object. If you find no plans, return an empty array for the "plans" key.
            Do not include any text, markdown formatting, or comments before or after the JSON object.

            TEXT TO ANALYZE:
            ---
            ${textContent.substring(0, 30000)} 
            ---
        `;

        console.log('Sending content to Google Gemini for analysis...');
        
        const result = await model.generateContent(prompt);
        const response = result.response;
        const responseText = response.text();
        
        // منطق قوي لتنظيف واستخلاص JSON
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            console.warn("Gemini response did not contain a recognizable JSON object. Raw response:", responseText);
            throw new Error("Gemini did not return a valid JSON object.");
        }
        
        const jsonString = jsonMatch[0];
        const parsedData = JSON.parse(jsonString);

        const plans: ExtractedPlan[] = parsedData.plans || (Array.isArray(parsedData) ? parsedData : []);

        if (!Array.isArray(plans)) {
             throw new Error("The extracted data `plans` key is not an array.");
        }
        
        console.log(`✅ Success: Analyzed and extracted ${plans.length} plans via Gemini.`);
        return plans;

    } catch (error: any) {
        console.error('❌ Failed in Stage 3 (AI Analysis):', error.message);
        // التحقق من وجود 'response' في الخطأ قبل محاولة الوصول إليه
        if (error.response && typeof (error.response as any).text === 'function') {
            console.error('Gemini Raw Response:', (error.response as any).text());
        }
        throw error;
    }
}

// --- (اختياري) قسم لتشغيل هذا الملف بشكل مستقل للاختبار ---
// هذا الكود سيعمل فقط إذا قمت بتشغيل `ts-node src/extract_plans.ts` مباشرة.
if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        console.log('Running in standalone test mode...');
        const INPUT_FILE = join('output', 'extracted_text.txt');
        const OUTPUT_FILE = join('output', 'test_extraction_result.json');
        try {
            const textContent = await readFile(INPUT_FILE, 'utf-8');
            const plans = await analyzeTextWithAI(textContent);
            await writeFile(OUTPUT_FILE, JSON.stringify(plans, null, 2));
            console.log(`Test extraction successful. Results saved to ${OUTPUT_FILE}`);
        } catch (e: any) {
            console.error("Test run failed:", e.message);
        }
    })();
}