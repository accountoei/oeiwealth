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
 */
export async function requireAppUser(): Promise<AppUser> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: appUser } = await supabase
    .from("app_users")
    .select("id,email,role,status,person_id")
    .eq("auth_user_id", user.id)
    .maybeSingle<AppUser>();
  if (!appUser || appUser.status !== "ACTIVE") redirect("/login?error=no_access");

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const hasFactor = aal?.nextLevel === "aal2";
  const verified = aal?.currentLevel === "aal2";
  if ((appUser.role === "ADMIN" || hasFactor) && !verified) redirect("/mfa");

  return appUser;
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "ผู้ดูแลระบบ",
  EDITOR: "ผู้แก้ไข",
  CONTRIBUTOR: "ผู้บันทึก",
  VIEWER: "ผู้ดู",
};
