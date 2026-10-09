# สำรองข้อมูลและกู้คืน (Backup / Restore)

Supabase แผน Free **ไม่มี Backup ให้** ระบบนี้จึงสำรองข้อมูลเองทุกสัปดาห์ผ่าน GitHub Actions

| | |
|---|---|
| ทำเมื่อไร | ทุกวันอาทิตย์ ตี 2 (เวลาไทย) และกดรันเองได้ |
| เก็บอะไร | ทุกอย่างในฐานข้อมูล: ผู้ใช้ (auth), โครงสร้างตาราง / Function / RLS และข้อมูลทั้งหมด |
| เก็บที่ไหน | Google Drive ที่เชื่อมไว้ในแอป → โฟลเดอร์ `Family Wealth Vault - …/10 สำรองข้อมูล (เข้ารหัส)` |
| เก็บกี่ไฟล์ | 52 ไฟล์ล่าสุด (≈ 1 ปี) ที่เก่ากว่านั้นย้ายไปถังขยะของ Drive |
| ความปลอดภัย | เข้ารหัส AES-256 ก่อนออกจากเครื่องที่รันงาน · ไม่มีไฟล์สำรองเก็บใน GitHub (repo นี้เป็น Public) |
| ดูผล | แอป → Settings → System → ตารางงานล่าสุด (BACKUP · สำเร็จ / ล้มเหลว) |

ไฟล์ที่เกี่ยวข้อง: `.github/workflows/db-backup.yml` · `supabase/functions/drive/index.ts` (action `backup`, `backup_log`)

**ไม่ได้อยู่ในไฟล์สำรอง** (ต้องเก็บแยก):
- Vault key `fwv_bank_account_key` → ใช้สำเนา Offline ที่เก็บไว้ตอนติดตั้ง (Physical Schema ข้อ 2.3) ถ้าไม่มี เลขบัญชีเต็มจะอ่านไม่ได้หลังกู้คืน
- การเชื่อม Google Drive → กด "เชื่อม Google Drive" ใหม่หลังกู้คืน
- ไฟล์เอกสาร → อยู่ใน Google Drive อยู่แล้ว ไม่ได้อยู่ในฐานข้อมูล

---

## ส่วนที่ 1 · ติดตั้ง (ครั้งเดียว ประมาณ 15–20 นาที)

### 1.1 Redeploy Edge Function `drive`

1. Supabase → **Edge Functions** → `drive` → **Code**
2. ลบโค้ดเดิมทั้งหมด → วางโค้ดใหม่จาก `supabase/functions/drive/index.ts` → **Deploy**
3. ตรวจว่า **Verify JWT ยังปิดอยู่** (เหมือนเดิม)

### 1.2 เตรียม `SUPABASE_DB_URL`

1. Supabase → ปุ่ม **Connect** (ด้านบน) → แท็บ **Connection String**
2. เลือก **Session pooler** (ห้ามใช้ Direct connection — GitHub ต่อไม่ได้ · ห้ามใช้ Transaction pooler)
3. คัดลอก URI จะหน้าตาประมาณ `postgresql://postgres.ljrz…:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres`
4. แทน `[YOUR-PASSWORD]` ด้วยรหัสผ่านฐานข้อมูล
   - ถ้าจำไม่ได้: Project Settings → **Database** → **Reset database password** → กด **Generate a password** → คัดลอกเก็บไว้
   - การ Reset ไม่กระทบแอป (แอปใช้ API key ไม่ได้ใช้รหัสนี้)
   - ถ้ารหัสมีอักขระพิเศษ เช่น `@ # / ? %` ให้ Generate ใหม่จนได้รหัสที่มีแค่ตัวอักษรและตัวเลข

### 1.3 ตั้ง `BACKUP_PASSPHRASE`

- รหัสยาว **อย่างน้อย 20 ตัวอักษร** เช่น ใช้ Password Manager สร้างให้ หรือคำภาษาอังกฤษสุ่ม 5–6 คำต่อกัน
- **จดเก็บไว้นอกระบบอย่างน้อย 2 ที่** (เช่น Password Manager ของ ADMIN ทั้งสองคน หรือกระดาษในตู้เซฟ)
- ⚠️ ถ้ารหัสนี้หาย ไฟล์สำรองทุกไฟล์จะเปิดไม่ได้อีกเลย · ห้ามส่งรหัสนี้ทางแชต / อีเมล

### 1.4 ใส่ Secrets ใน GitHub

GitHub → repo `oeiwealth` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** ทีละตัว:

| Name | Value |
|---|---|
| `SUPABASE_DB_URL` | จากข้อ 1.2 |
| `BACKUP_PASSPHRASE` | จากข้อ 1.3 |

(`SUPABASE_URL` และ `SUPABASE_SECRET_KEY` มีอยู่แล้วจาก FX Job ไม่ต้องทำอะไร)

### 1.5 ทดลองรันครั้งแรก

1. GitHub → แท็บ **Actions** → **Database backup (weekly)** → **Run workflow** → **Run workflow**
2. รอ 2–5 นาที ต้องขึ้น ✅ สีเขียว
3. ตรวจ 3 จุด:
   - Google Drive มีโฟลเดอร์ `10 สำรองข้อมูล (เข้ารหัส)` และไฟล์ `fwv-backup_ปปปป-ดด-วว_ชชนน.tar.gz.gpg`
   - แอป → Settings → System → มีแถว **BACKUP · สำเร็จ**
   - ลองเปิดไฟล์ใน Drive → ต้องอ่านไม่ออก (เข้ารหัสแล้ว)

ถ้าขึ้น ❌ สีแดง: กดเข้าไปดูขั้นที่แดง แล้วส่งข้อความ error ให้ AI / IT ดู (ข้อความ error ไม่มีรหัสผ่าน)
ถ้างานตามรอบล้มเหลว GitHub จะส่งอีเมลแจ้งคนที่แก้ไฟล์ workflow ล่าสุด

---

## ส่วนที่ 2 · กู้คืน (ทำโดย IT)

ใช้เมื่อข้อมูลเสียหาย / Project ถูกลบ / ต้องย้าย Project · **กู้ลง Project ใหม่เสมอ** อย่ากู้ทับ Project เดิมที่ยังมีข้อมูล

### 2.1 ถอดรหัสไฟล์

ดาวน์โหลดไฟล์ `.gpg` ล่าสุดจาก Drive แล้ว:

- **Windows:** ติดตั้ง [Gpg4win](https://gpg4win.org) → คลิกขวาไฟล์ → Decrypt → ใส่ BACKUP_PASSPHRASE → ได้ `.tar.gz` → แตกไฟล์ (7-Zip)
- **Mac / Linux:**
  ```bash
  gpg -d fwv-backup_YYYY-MM-DD_HHMM.tar.gz.gpg | tar -xzf -
  ```

จะได้ 4 ไฟล์: `MANIFEST.txt`, `roles.sql`, `schema.sql`, `data.sql`

### 2.2 สร้าง Project ใหม่และกู้ข้อมูล

1. Supabase → **New project** (Region: Singapore) → จด Database password
2. Vault → New secret ชื่อ `fwv_bank_account_key` → ใส่ค่า**เดิม**จากสำเนา Offline (ต้องตรงทุกตัวอักษร)
3. คัดลอก Session pooler URI ของ Project ใหม่ (เหมือนข้อ 1.2) แล้วรันในเครื่องที่มี `psql` (PostgreSQL 17):
   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql \
     --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql \
     --dbname "postgresql://postgres.<ref-ใหม่>:<password>@aws-…pooler.supabase.com:5432/postgres"
   ```
   (ทั้งหมดอยู่ใน Transaction เดียว ถ้ามี error จะไม่มีอะไรถูกบันทึกครึ่งๆ กลางๆ)

### 2.3 ต่อระบบเข้ากับ Project ใหม่

1. Authentication → ปิด *Allow new users to sign up* · API → Exposed schemas มีแค่ `public`
2. Edge Functions: Deploy `invite-user` และ `drive` ใหม่ (ปิด Verify JWT) · ตั้ง Secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
3. Google Cloud Console → OAuth redirect URI เปลี่ยนเป็น `https://<ref-ใหม่>.supabase.co/functions/v1/drive`
4. Vercel → Environment Variables → `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` ของ Project ใหม่ → Redeploy
5. GitHub Secrets → `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_URL` ของ Project ใหม่
6. เข้าแอปด้วยบัญชีเดิม (รหัสผ่านและ MFA เดิมใช้ได้) → Documents → **เชื่อม Google Drive** ใหม่ด้วยบัญชีเดิม
7. ตรวจ: Dashboard ยอด Net Worth ตรงกับก่อนเสีย · เปิดดูเลขบัญชีเต็มได้ 1 บัญชี · เปิดเอกสารได้ 1 ไฟล์

### 2.4 ซ้อมกู้คืน (แนะนำทุก 3–6 เดือน)

ไฟล์สำรองที่ไม่เคยลองกู้ = ยังไม่รู้ว่าใช้ได้จริง · ซ้อมโดยทำข้อ 2.1–2.2 ลง Project ใหม่ (แผน Free สร้างได้ 2 Project) → ตรวจยอด Net Worth → ลบ Project ทดสอบทิ้ง
