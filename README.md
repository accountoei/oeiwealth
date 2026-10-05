# oeiwealth — Family Wealth Vault

ระบบบันทึกทรัพย์สิน หนี้สิน และ Net Worth ของครอบครัว (Next.js + Supabase)

| โฟลเดอร์ | เนื้อหา |
|---|---|
| `src/` | หน้าเว็บ (Next.js App Router) |
| `supabase/migrations/` | โครงสร้างฐานข้อมูล — รันตามลำดับชื่อไฟล์ |
| `tests/` | ชุดทดสอบฐานข้อมูล (รันในเครื่องเท่านั้น ห้ามรันบน Supabase) |
| `docs/` | เอกสาร Physical Schema V1.1 |

## Environment Variables (Vercel)

| ชื่อ | ค่า |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon / publishable key |

ห้ามใส่ `service_role` key ในแอปหน้าเว็บ

## สถานะหน้าจอ

- ✅ Login · MFA (บังคับสำหรับ ADMIN) · โครงเมนู · Dashboard (สถานะ Setup) · Family & Users (+ เชิญผู้ใช้) · Cash & Deposits
- ✅ Liabilities · Credit Cards · Property & Leases · Investments · Income & Expenses · Month Closing · Loans · Alternative · Insurance · Opening Setup · System (FX)
- ✅ แก้ไข / ลบรายการ (Soft Delete) · แก้สัดส่วนเจ้าของ / ผู้รับผิดชอบหนี้ / ผู้รับผลประโยชน์
- ⬜ หน้าอื่นตาม Wireframe V1.1 — ทยอยเพิ่ม

## Supabase Keep-alive (GitHub Actions)

`.github/workflows/supabase-keepalive.yml` เรียก `rpc/keepalive` ทุก 3 วัน (อ่านอย่างเดียว ไม่เขียนข้อมูล ไม่คืนข้อมูลครอบครัว)
เพื่อกัน Supabase แผน Free ถูก Pause · ต้องตั้ง Repository secrets: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`

## FX Job — อัตราแลกเปลี่ยน ธปท. (GitHub Actions)

`.github/workflows/fx-rates.yml` รันทุกวัน 19:30 (ดึงย้อนหลัง 10 วัน) และกดรันเองเพื่อ Backfill ช่วงวันที่ได้
สคริปต์: `scripts/fx-fetch.mjs` · ใช้ `mid_rate` (ไม่มี → เฉลี่ย buying_transfer/selling) · สกุลที่ประกาศต่อ 100 หน่วยถูกแปลงเป็นต่อ 1 หน่วย
Repository secrets: `BOT_API_TOKEN`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (เก็บใน GitHub Secrets เท่านั้น ห้ามใส่ใน Vercel)

## Edge Function: invite-user

`supabase/functions/invite-user/index.ts` — ADMIN (ยืนยัน MFA แล้ว) เชิญผู้ใช้ใหม่จากหน้า Family & Users
ระบบ **ไม่ส่งอีเมล** แต่สร้างลิงก์ `/auth/accept?...` ให้ ADMIN คัดลอกไปส่งเอง (ไม่ต้องตั้ง SMTP)
ติดตั้ง: Supabase → Edge Functions → Deploy a new function → Via Editor → ชื่อ `invite-user` → วางโค้ด → ปิด "Verify JWT" (ฟังก์ชันตรวจสิทธิ์เอง)
