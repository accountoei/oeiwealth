import type { createClient } from "@/lib/supabase/server";

type Sb = Awaited<ReturnType<typeof createClient>>;

/**
 * รูปครอบครัว = ไฟล์แยกที่ /family-photo (เบราว์เซอร์จำไว้) แทนการฝังรูปไปกับทุกหน้า (ตกลง 6 พ.ย. 2026)
 *   ไม่มีรูป → null (แสดงชื่อย่อแทน) · v = เวลาแก้ไขข้อมูลครอบครัวล่าสุด → เปลี่ยนรูปแล้วเบราว์เซอร์โหลดรูปใหม่เอง
 */
export async function loadFamilyPhotoUrl(supabase: Sb): Promise<string | null> {
  const { data } = await supabase.from("families").select("updated_at").not("photo", "is", null).maybeSingle();
  return data ? `/family-photo?v=${encodeURIComponent(String(data.updated_at))}` : null;
}
