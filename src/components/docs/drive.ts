"use client";

import { createClient } from "@/lib/supabase/client";

const FN = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/drive`;

/** เรียก Edge Function "drive" จากเบราว์เซอร์ (ไฟล์ไม่ผ่าน Vercel → ไม่ติดขนาด 4.5 MB) */
export async function callDrive(body: FormData | Record<string, unknown>): Promise<Response> {
  const { data } = await createClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Session หมดอายุ กรุณาเข้าสู่ระบบใหม่");
  const isForm = body instanceof FormData;
  let r: Response;
  try {
    r = await fetch(FN, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        ...(isForm ? {} : { "Content-Type": "application/json" }) },
      body: isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new Error("ติดต่อ Edge Function \"drive\" ไม่ได้ (ยังไม่ได้ติดตั้ง หรือเครือข่ายมีปัญหา)");
  }
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    throw new Error(j?.error ?? (r.status === 404 ? "ยังไม่ได้ติดตั้ง Edge Function \"drive\" ใน Supabase" : `เกิดข้อผิดพลาด (${r.status})`));
  }
  return r;
}
