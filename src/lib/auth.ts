import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "ADMIN" | "EDITOR" | "CONTRIBUTOR" | "VIEWER";

export type AppUser = {
  id: string;
  email: string;
  role: Role;
  status: "INVITED" | "ACTIVE" | "DISABLED";
  person_id: string | null;
};

/**
 * ใช้ใน Layout ของทุกหน้าที่ต้อง Login:
 * - ต้องมีแถวใน app_users ที่ ACTIVE (DISABLED / ไม่มีสิทธิ์ → ออกจากระบบ)
 * - ADMIN ต้องเปิด MFA (Core Schema Section 5) และทุกคนที่ตั้ง MFA แล้วต้องยืนยันรหัสก่อนเข้า
 *
 * ความเร็ว: ห่อด้วย React cache() → Layout + Page ใน Request เดียวกันเรียกซ้ำได้โดยไม่ยิง Supabase ซ้ำ
 * และอ่าน user (Auth) กับ app_users (DB) พร้อมกัน แทนที่จะรอทีละขั้น
 * (ใช้ sub จาก getClaims() ซึ่งตรวจลายเซ็น JWT แล้ว · getUser() ยังเรียกเพื่อเช็กว่าบัญชียังใช้ได้และดู MFA factors)
 */
export const requireAppUser = cache(async (): Promise<AppUser> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) redirect("/login");

  const [{ data: { user } }, { data: appUser }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("app_users")
      .select("id,email,role,status,person_id")
      .eq("auth_user_id", claims.sub)
      .maybeSingle<AppUser>(),
  ]);
  if (!user || user.id !== claims.sub) redirect("/login");
  if (!appUser || appUser.status !== "ACTIVE") redirect("/login?error=no_access");

  // เทียบเท่า mfa.getAuthenticatorAssuranceLevel() แต่ใช้ข้อมูลที่โหลดมาแล้ว ไม่ต้องยิงซ้ำ
  const hasFactor = (user.factors ?? []).some((f) => f.status === "verified");
  const verified = claims.aal === "aal2";
  if ((appUser.role === "ADMIN" || hasFactor) && !verified) redirect("/mfa");

  return appUser;
});

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "ผู้ดูแลระบบ",
  EDITOR: "ผู้แก้ไข",
  CONTRIBUTOR: "ผู้บันทึก",
  VIEWER: "ผู้ดู",
};
