"use server";

import { revalidatePath } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/format";

export type PendingState = { error?: string; ok?: string };

/** ราคาอัตโนมัติที่รอยืนยัน: ยืนยันเป็นราคาฐาน (confirm) / ไม่ใช้ราคานี้ (dismiss) — ฐานข้อมูลตรวจสิทธิ์ ADMIN / EDITOR + งวดบัญชี */
export async function resolvePendingPrice(_: PendingState, form: FormData): Promise<PendingState> {
  const supabase = await createClient();
  const kind = String(form.get("kind") ?? "");
  const id = String(form.get("id") ?? "");
  const op = String(form.get("op") ?? "");
  if (!id || !["holding", "gold"].includes(kind) || !["confirm", "dismiss"].includes(op)) return { error: "ข้อมูลไม่ครบ" };
  const args = kind === "holding" ? { p_holding_id: id, p_asset_id: null } : { p_holding_id: null, p_asset_id: id };
  const { data, error } = await supabase.rpc(op === "confirm" ? "confirm_pending_price" : "dismiss_pending_price", args);
  if (error) return { error: friendlyError(error.message) };
  String(form.get("paths") ?? "").split(",").filter(Boolean).forEach((p) => revalidatePath(p));
  revalidatePath("/");
  if (op === "dismiss") return { ok: "ไม่ใช้ราคานี้แล้ว" };
  return (data as { confirmed?: boolean } | null)?.confirmed === false
    ? { ok: "วันนั้นมีราคาที่บันทึกไว้แล้ว — ใช้ราคานั้นเป็นราคาฐาน" }
    : { ok: "บันทึกเป็นราคาฐานแล้ว" };
}
