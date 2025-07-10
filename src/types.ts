// src/types.ts

// نوع يمثل البيانات القادمة من Supabase
export interface ScrapeSessionPayload {
    id: string;
    competitor_id: string;
    status: 'pending' | 'success' | 'failed';
    scraped_at: string;
    error_message: string | null;
}

export interface Competitor {
    id: string;
    name: string;
    pricing_page_url: string;
}

// نوع يمثل الخطة كما يعيدها Gemini
export interface ExtractedPlan {
    planName: string;
    price: number | null;
    currency: string;
    billingCycle: 'monthly' | 'annually' | 'one_time';
    description: string;
    features: string[];
}