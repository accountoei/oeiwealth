import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient as createJsClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { todayBangkok } from "@/lib/format";

/**
 * จำผลคำนวณที่หนักไว้ข้ามคำขอ (30 ต.ค. 2026 · ปรับ 1 พ.ย. 2026) — Dashboard + ผลตอบแทนพอร์ต + ตัวเลข To-Do ที่เมนูซ้าย
 * Supabase แผนฟรี CPU เล็ก → ฟังก์ชัน Dashboard ใช้ 0.5–1 วินาที (บางครั้ง 5–7 วินาทีเมื่อชนกัน) ถ้าคำนวณใหม่ทุกคลิก
 *
 * - คีย์ = ผู้ใช้ + วันนี้ (เวลาไทย) + ป้ายข้อมูล + รุ่นที่ deploy + ชื่องาน + ค่าที่ส่ง
 *   → ผู้ใช้แต่ละคนเห็นผลของตัวเองเท่านั้น (RLS เดิมยังทำงานตอนคำนวณ) · ขึ้นวันใหม่ / deploy ใหม่ = คำนวณใหม่
 * - ล้างทันทีเมื่อมีการบันทึกใด ๆ: ทุก Server Action เรียก revalidatePath จาก "@/lib/revalidate" ซึ่งล้างแท็ก DATA_TAG ด้วย
 * - งานเบื้องหลัง (อัตราแลกเปลี่ยน / ราคาอัตโนมัติ / ยอดสิ้นเดือนอัตโนมัติ) ไม่ผ่าน Server Action
 *   → ทุกคำขอถาม "ป้ายข้อมูล" (public.data_version = ประวัติงานเบื้องหลังล่าสุด) 1 คำสั่งเล็ก ๆ แล้วใส่ในคีย์
 *   → งานเสร็จปุ๊บ ป้ายเปลี่ยน ผลเดิมไม่ถูกใช้ คำนวณใหม่ทันที
 * - เพดานกันพลาด CACHE_TTL (1 ชั่วโมง) เช่น แก้ข้อมูลตรงใน Supabase · ถามป้ายไม่ได้ → จำไว้แค่ 5 นาที
 */
export const DATA_TAG = "fwv-data";
/** เพดานกันพลาด (วินาที) — ปกติผลถูกล้างก่อนถึงเพดานเมื่อมีการบันทึก / งานเบื้องหลังเสร็จ */
export const CACHE_TTL = 3600;
/** ถามป้ายข้อมูลไม่ได้ (เช่น ยังไม่ได้รัน SQL) → ไม่รู้ว่างานเบื้องหลังเสร็จหรือยัง จึงจำไว้สั้นกว่า */
const NO_VERSION_TTL = 300;
/** รุ่นที่ deploy (Vercel ใส่ให้เอง · บนเครื่องว่าง) → deploy ใหม่ไม่ใช้ผลที่จำจากโค้ดรุ่นก่อน */
const DEPLOY = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "";

/** ผู้ใช้ + token + ป้ายข้อมูลของคำขอนี้ (อ่าน cookie นอกส่วนที่จำไว้ ตามกติกาของ unstable_cache) · ถามป้ายพร้อมกับเช็กผู้ใช้ */
const session = cache(async () => {
  const supabase = await createClient();
  const tokenP = supabase.auth.getSession().then(({ data }) => data.session?.access_token);
  const [{ data: claims }, token, version] = await Promise.all([
    supabase.auth.getClaims(), tokenP, tokenP.then((t) => (t ? dataVersion(t) : "")),
  ]);
  const userId = claims?.claims?.sub as string | undefined;
  return userId && token ? { userId, token, version } : null;
});

/** ป้ายข้อมูล: เปลี่ยนทุกครั้งที่งานเบื้องหลังบันทึก (ทุก Role อ่านได้ · ได้แค่ตัวเลข) · error → "" */
async function dataVersion(token: string): Promise<string> {
  try {
    const { data, error } = await tokenClient(token).rpc("data_version");
    return error || data == null ? "" : String(data);
  } catch {
    return "";
  }
}

/** Supabase client ที่ไม่แตะ cookie (ใช้ภายในส่วนที่จำไว้) · สิทธิ์เท่ากับผู้ใช้เจ้าของ token */
function tokenClient(token: string): SupabaseClient {
  return createJsClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** เรียก run(supabase) ครั้งแรก แล้วจำผลไว้ (ไม่มี session → คำนวณสดตามปกติ) */
export async function cachedData<T>(key: (string | number | null)[], run: (supabase: SupabaseClient) => Promise<T>, ttl = CACHE_TTL): Promise<T> {
  const s = await session();
  if (!s) return run(await createClient());
  const { token, version } = s;
  return unstable_cache(() => run(tokenClient(token)), ["fwv", s.userId, todayBangkok(), version, DEPLOY, ...key.map((k) => String(k ?? ""))],
    { tags: [DATA_TAG], revalidate: version ? ttl : Math.min(ttl, NO_VERSION_TTL) })();
}

/** RPC ที่จำผลไว้ (คืน data หรือ null เหมือนเดิม) — ถ้า error จะไม่จำ: คืน null แล้วคำนวณใหม่ครั้งหน้า */
export async function cachedRpc<T>(fn: string, args: Record<string, unknown> = {}, ttl = CACHE_TTL): Promise<T | null> {
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
