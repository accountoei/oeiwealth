import type { Metadata } from "next";
import { requireAppUser } from "@/lib/auth";

/**
 * ชื่อแท็บเบราว์เซอร์ของหน้ารายละเอียด: "ชื่อรายการ · เมนู" (root layout ต่อท้าย "· Family Wealth Vault" ให้)
 * ใช้ใน generateMetadata คู่กับตัวโหลดข้อมูลหลักของหน้าที่ห่อด้วย React cache() → หน้าเรียกตัวเดียวกันใน Promise.all ไม่ยิง Supabase ซ้ำ
 * เช็กสิทธิ์ก่อน (requireAppUser ก็ cache ไว้แล้ว) → ผู้ที่ยังไม่ผ่าน MFA ไม่เห็นชื่อรายการในแท็บ
 * ห้ามใส่เลขบัญชี / เลขกรมธรรม์ / เลขบัตร ในชื่อแท็บ (ชื่อแท็บไปอยู่ในประวัติเบราว์เซอร์และแท็บที่ซิงก์ข้ามเครื่อง)
 */
export async function detailTitle(load: () => Promise<string | null | undefined>, menu: string): Promise<Metadata> {
  await requireAppUser();
  const name = (await load())?.trim();
  return { title: name ? `${name} · ${menu}` : menu };
}
