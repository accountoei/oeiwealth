import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient as createJsClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { todayBangkok } from "@/lib/format";

/**
 * จำผลคำนวณที่หนักไว้ข้ามคำขอ (30 ต.ค. 2026) — Dashboard + ตัวเลข To-Do ที่เมนูซ้าย
 * Supabase แผนฟรี CPU เล็ก → ฟังก์ชัน Dashboard ใช้ 0.5–1 วินาที (บางครั้ง 5–7 วินาทีเมื่อชนกัน) ถ้าคำนวณใหม่ทุกคลิก
 *
 * - คีย์ = ผู้ใช้ + วันนี้ (เวลาไทย) + ชื่องาน + ค่าที่ส่ง → ผู้ใช้แต่ละคนเห็นผลของตัวเองเท่านั้น (RLS เดิมยังทำงานตอนคำนวณ)
 * - ล้างทันทีเมื่อมีการบันทึกใด ๆ: ทุก Server Action เรียก revalidatePath จาก "@/lib/revalidate" ซึ่งล้างแท็ก DATA_TAG ด้วย
 * - งานเบื้องหลัง (อัตราแลกเปลี่ยน / ราคาอัตโนมัติ / snapshot สิ้นเดือน) ไม่ผ่าน Server Action → ผลใหม่ขึ้นภายใน ttl วินาที
 */
export const DATA_TAG = "fwv-data";

/** ผู้ใช้ + token ของคำขอนี้ (อ่าน cookie นอกส่วนที่จำไว้ ตามกติกาของ unstable_cache) */
const session = cache(async () => {
  const supabase = await createClient();
  const [{ data: claims }, { data: s }] = await Promise.all([supabase.auth.getClaims(), supabase.auth.getSession()]);
  const userId = claims?.claims?.sub as string | undefined;
  const token = s.session?.access_token;
  return userId && token ? { userId, token } : null;
});

/** Supabase client ที่ไม่แตะ cookie (ใช้ภายในส่วนที่จำไว้) · สิทธิ์เท่ากับผู้ใช้เจ้าของ token */
function tokenClient(token: string): SupabaseClient {
  return createJsClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** เรียก run(supabase) ครั้งแรก แล้วจำผลไว้ (ไม่มี session → คำนวณสดตามปกติ) */
export async function cachedData<T>(key: (string | number | null)[], run: (supabase: SupabaseClient) => Promise<T>, ttl: number): Promise<T> {
  const s = await session();
  if (!s) return run(await createClient());
  const { token } = s;
  return unstable_cache(() => run(tokenClient(token)), ["fwv", s.userId, todayBangkok(), ...key.map((k) => String(k ?? ""))],
    { tags: [DATA_TAG], revalidate: ttl })();
}

/** RPC ที่จำผลไว้ (คืน data หรือ null เหมือนเดิม) — ถ้า error จะไม่จำ: คืน null แล้วคำนวณใหม่ครั้งหน้า */
export async function cachedRpc<T>(fn: string, args: Record<string, unknown> = {}, ttl = 600): Promise<T | null> {
  try {
    return await cachedData(["rpc", fn, JSON.stringify(args)], async (supabase) => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw new Error(error.message);
      return (data ?? null) as T | null;
    }, ttl);
  } catch {
    return null;
  }
}
