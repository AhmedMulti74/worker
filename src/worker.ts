// src/worker.ts

import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { scrapePage } from './scraper.js';
import { extractText } from './parse.js';
import { analyzeTextWithAI } from './extract_plans.js';
import type { ScrapeSessionPayload, Competitor, ExtractedPlan } from './types.js'; // استيراد الأنواع من ملف مركزي

// تحميل متغيرات البيئة من ملف .env
dotenv.config();

// التحقق من وجود المتغيرات الأساسية
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ FATAL: Supabase environment variables not found in .env file');
    process.exit(1);
}

// تهيئة عميل Supabase باستخدام مفتاح الخدمة للحصول على صلاحيات كاملة
const supabase: SupabaseClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * يضع علامة على البيانات القديمة بأنها غير حالية (أرشفتها) قبل إدراج البيانات الجديدة.
 * @param {string} competitorId - معرف المنافس
 */
async function archiveOldData(competitorId: string): Promise<void> {
    console.log(`Archiving old data for competitor ID: ${competitorId}`);
    
    const { data: old_plans, error: fetchError } = await supabase
        .from('pricing_plans')
        .select('id')
        .eq('competitor_id', competitorId)
        .eq('is_current', true);

    if (fetchError) {
        console.error('Error fetching old plans to archive:', fetchError.message);
        return;
    }
    
    if (!old_plans || old_plans.length === 0) {
        console.log('No current data to archive.');
        return;
    }

    const oldPlanIds = old_plans.map(p => p.id);

    await supabase.from('plan_features').update({ is_current: false }).in('plan_id', oldPlanIds);
    await supabase.from('pricing_plans').update({ is_current: false }).in('id', oldPlanIds);
    
    console.log(`Archived ${oldPlanIds.length} old plans and their features.`);
}

/**
 * الدالة الرئيسية لمعالجة جلسة كشط جديدة
 * @param {ScrapeSessionPayload} session - سجل جلسة الكشط الجديدة من قاعدة البيانات
 */
async function processScrapeSession(session: ScrapeSessionPayload): Promise<void> {
    const { data: competitor, error: competitorError } = await supabase
        .from('competitors')
        .select('id, name, pricing_page_url')
        .eq('id', session.competitor_id)
        .single<Competitor>(); // تحديد أننا نتوقع كائن Competitor واحد

    if (competitorError || !competitor) {
        const errorMessage = `Competitor not found for session ID: ${session.id}. Error: ${competitorError?.message}`;
        console.error(errorMessage);
        await supabase.from('scrape_sessions').update({ status: 'failed', error_message: errorMessage }).eq('id', session.id);
        return;
    }

    console.log(`\n🚀 New job received for competitor: ${competitor.name} (Session ID: ${session.id})`);
    
    try {
        // --- تنفيذ المراحل الثلاث بالتسلسل ---
        await scrapePage(competitor.pricing_page_url);
        const textContent = await extractText();
        const plans: ExtractedPlan[] = await analyzeTextWithAI(textContent);
        
        if (plans.length === 0) {
            throw new Error("AI model did not return any plans in the expected format.");
        }

        await archiveOldData(competitor.id);

        for (const plan of plans) {
            const { data: planData, error: planError } = await supabase
                .from('pricing_plans')
                .insert({
                    scrape_session_id: session.id,
                    competitor_id: competitor.id,
                    plan_name: plan.planName,
                    price: typeof plan.price === 'number' ? plan.price : 0,
                    currency: plan.currency || 'USD',
                    billing_cycle: ['monthly', 'annually', 'one_time'].includes(plan.billingCycle) ? plan.billingCycle : 'monthly',
                    description: plan.description,
                    is_current: true
                })
                .select('id')
                .single();

            if (planError) throw new Error(`Failed to insert plan "${plan.planName}": ${planError.message}`);
            if (!planData) throw new Error(`Insert for plan "${plan.planName}" did not return data.`);
            
            if (plan.features && Array.isArray(plan.features) && plan.features.length > 0) {
                const featuresToInsert = plan.features.map(f => ({
                    plan_id: planData.id,
                    feature_text: f,
                    is_current: true
                }));
                const { error: featureError } = await supabase.from('plan_features').insert(featuresToInsert);
                if (featureError) console.warn(`Could not insert features for plan ${plan.planName}: ${featureError.message}`);
            }
        }
        
        await supabase.from('scrape_sessions').update({ status: 'success', error_message: null }).eq('id', session.id);
        console.log(`✅ Job for ${competitor.name} completed successfully!`);

    } catch (error: any) {
        console.error(`❌ Job for ${competitor.name} failed:`, error.message);
        await supabase
            .from('scrape_sessions')
            .update({ status: 'failed', error_message: error.message.substring(0, 500) })
            .eq('id', session.id);
    }
}

// --- الاستماع للتغييرات في قاعدة البيانات ---
function setupListener(): RealtimeChannel {
    console.log('Worker is running and listening for new scrape sessions...');

    const channel = supabase.channel('public:scrape_sessions')
        .on<ScrapeSessionPayload>(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'scrape_sessions' },
            (payload) => {
                console.log('New scrape session detected!', payload.new);
                if (payload.new.status === 'pending') {
                    // لا تستخدم await هنا للسماح للمستمع بالاستجابة بسرعة
                    // وبدء المعالجة في الخلفية
                    processScrapeSession(payload.new);
                }
            }
        )
        .subscribe((status, err) => {
            if (status === 'SUBSCRIBED') console.log('Successfully subscribed to database changes!');
            if (status === 'CHANNEL_ERROR') console.error('Channel error, attempting to reconnect...', err);
            if(status === 'TIMED_OUT') console.warn('Subscription timed out. The connection will be re-established.');
        });

    return channel;
}

const mainChannel = setupListener();

// إيقاف تشغيل نظيف
process.on('SIGINT', async () => {
    console.log('Shutting down worker...');
    await supabase.removeChannel(mainChannel);
    process.exit(0);
});