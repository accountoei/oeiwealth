import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * รายการ "จ่ายจาก / รับเข้า" ที่หลายหน้าโหลดเหมือนกัน — แก้คอลัมน์ / ลำดับที่นี่ที่เดียว
 * คืนคำสั่ง supabase (ยังไม่ส่ง) → ใส่ใน Promise.all รอบเดียวกับคำสั่งอื่นของหน้าได้เลย
 * ป้ายชื่อบัตร: cardLabel ใน src/lib/money-endpoint.ts
 */

/** บัญชีธนาคารที่ใช้งาน เรียงตามลำดับที่ตั้งไว้ (pick_order) · frequent = ใช้บ่อย (BankOptions แสดงกลุ่ม "ใช้บ่อย") */
export const activeBanks = (supabase: SupabaseClient) =>
  supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,frequent").eq("status", "ACTIVE").order("pick_order");

/** บัตรเครดิตที่ยังไม่ปิด */
export const openCards = (supabase: SupabaseClient) =>
  supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency").is("deleted_at", null).neq("status", "CLOSED");
