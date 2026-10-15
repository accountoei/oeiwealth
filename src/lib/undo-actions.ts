"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/format";

export type UndoState = { error?: string; ok?: string };

/** ยกเลิกทั้งก้อน: ผลประโยชน์ประกัน / คืนเงินประกันการเช่า / เงินต้น + ดอกเบี้ย (ฐานข้อมูลตรวจสิทธิ์ + งวดที่ปิดแล้ว) */
export async function undoWhole(_: UndoState, form: FormData): Promise<UndoState> {
  const supabase = await createClient();
  const kind = String(form.get("kind"));
  const id = String(form.get("id"));
  const rpc = kind === "BENEFIT" ? supabase.rpc("undo_insurance_benefit", { p_receipt_id: id })
    : kind === "DEPOSIT" ? supabase.rpc("undo_security_deposit", { p_lease_id: id })
    : kind === "PAYMENT" ? supabase.rpc("undo_payment_group", { p_group_id: id })
    : null;
  if (!rpc) return { error: "ประเภทไม่ถูกต้อง" };
  const { error } = await rpc;
  if (error) return { error: friendlyError(error.message) };
  String(form.get("paths") ?? "").split(",").filter(Boolean).forEach((p) => revalidatePath(p));
  ["/", "/income-expenses", "/financial/cash", "/liabilities", "/month-closing"].forEach((p) => revalidatePath(p));
  revalidatePath("/financial/cash", "layout");
  return { ok: "ยกเลิกแล้ว" };
}
