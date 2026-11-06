"use server";

import { revalidatePath } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/format";

export type UndoState = { error?: string; ok?: string };

/** ยกเลิกทั้งก้อน: ผลประโยชน์ประกัน / ผู้เช่าออก / คืนเงินประกันการเช่า / เงินต้น + ดอกเบี้ย / ขายบางส่วน (Alternative) (ฐานข้อมูลตรวจสิทธิ์ + งวดที่ปิดแล้ว) */
export async function undoWhole(_: UndoState, form: FormData): Promise<UndoState> {
  const supabase = await createClient();
  const kind = String(form.get("kind"));
  const id = String(form.get("id"));
  const rpc = kind === "BENEFIT" ? supabase.rpc("undo_insurance_benefit", { p_receipt_id: id })
    : kind === "CLOSEOUT" ? supabase.rpc("undo_close_lease", { p_lease_id: id })
    : kind === "DEPOSIT" ? supabase.rpc("undo_security_deposit", { p_lease_id: id })
    : kind === "PAYMENT" ? supabase.rpc("undo_payment_group", { p_group_id: id })
    : kind === "ALT_PART_SALE" ? supabase.rpc("undo_alternative_part_sale", { p_sale_id: id })
    : null;
  if (!rpc) return { error: "ประเภทไม่ถูกต้อง" };
  const { error } = await rpc;
  if (error) {
    const msg = friendlyError(error.message);
    // ผู้เช่าออกที่เลิกสัญญาไว้: ยกเลิกแล้วสัญญากลับมีผลถึงวันสิ้นสุด → ทับสัญญาอื่น (ข้อความบอกฉบับที่ต้องแก้)
    return { error: kind === "CLOSEOUT" && msg.includes("จะทับกับสัญญา")
      ? `ยกเลิกผู้เช่าออกไม่ได้ เพราะสัญญานี้จะกลับมามีผลถึงวันสิ้นสุดสัญญา — ${msg}` : msg };
  }
  String(form.get("paths") ?? "").split(",").filter(Boolean).forEach((p) => revalidatePath(p));
  ["/", "/income-expenses", "/financial/cash", "/liabilities", "/settings/month-closing", "/alternative"].forEach((p) => revalidatePath(p));
  revalidatePath("/financial/cash", "layout");
  return { ok: "ยกเลิกแล้ว" };
}
