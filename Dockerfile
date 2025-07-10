# --- المرحلة 1: البناء (Builder) ---
# نستخدم صورة Node.js لتثبيت جميع الاعتماديات (بما في ذلك dev) وبناء المشروع

FROM node:20-bookworm-slim AS builder

# تحديث حزم النظام لسد الثغرات الأمنية المعروفة
RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# نسخ ملفات package.json أولاً للاستفادة من التخزين المؤقت لـ Docker
COPY package*.json ./

# تثبيت جميع الاعتماديات اللازمة لـ TypeScript و Linter وغيرها
RUN npm install

# نسخ بقية كود المشروع
COPY . .

# ترجمة TypeScript إلى JavaScript
RUN npm run build


# --- المرحلة 2: الإنتاج (Production) ---
# نبدأ من صورة Playwright الرسمية النظيفة التي تحتوي على المتصفحات
FROM mcr.microsoft.com/playwright:v1.45.3-jammy

WORKDIR /app

# نسخ ملفات package.json مرة أخرى
COPY package*.json ./

# <<< التحسين الرئيسي هنا >>>
# تثبيت اعتماديات الإنتاج فقط. هذا يقلل من حجم الصورة ويزيد الأمان
RUN npm install --omit=dev

# نسخ الكود المترجم من مرحلة البناء
COPY --from=builder /app/dist ./dist

# تحديد الأمر الذي سيتم تشغيله عند بدء الحاوية
CMD ["npm", "run", "start"]