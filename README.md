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

- ✅ Login · MFA (บังคับสำหรับ ADMIN) · โครงเมนู · Dashboard (สถานะ Setup) · Family & Users
- ⬜ หน้าอื่นตาม Wireframe V1.1 — ทยอยเพิ่ม
