import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * รูปครอบครัว (เมนูซ้ายบน + กล่องครอบครัวหน้า Members) ส่งเป็นไฟล์รูป ไม่ฝังในหน้า
 *   อ่านผ่าน RLS ของผู้ใช้ที่ล็อกอิน (ไม่ได้ล็อกอิน → proxy ส่งไปหน้า login / ไม่มีสิทธิ์ → ไม่พบ)
 *   มี ?v= (เวลาแก้ไขล่าสุด) → จำไว้ได้นาน · เปลี่ยนรูปแล้ว v เปลี่ยน → โหลดใหม่
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.from("families").select("photo").maybeSingle();
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec((data as { photo: string | null } | null)?.photo ?? "");
  if (!m) return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const versioned = request.nextUrl.searchParams.has("v");
  return new Response(Buffer.from(m[2], "base64"), {
    headers: {
      "Content-Type": m[1],
      "Cache-Control": versioned ? "private, max-age=31536000, immutable" : "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
