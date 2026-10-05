"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/format";

export type FxState = { error?: string; ok?: string };

/** ADMIN Override (Core Schema Section 16): ใช้เมื่อ ธปท. ไม่มีข้อมูล / API มีปัญหา · ต้องมีเหตุผล · Audit FX_OVERRIDE */
export async function overrideFx(_: FxState, form: FormData): Promise<FxState> {
  const supabase = await createClient();
  const rate_date = String(form.get("rate_date") ?? "");
  const currency = String(form.get("currency") ?? "").trim().toUpperCase();
  const rate = Number(String(form.get("rate_to_thb") ?? "").replace(/,/g, ""));
  const reason = String(form.get("reason") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rate_date)) return { error: "กรุณาเลือกวันที่" };
  if (!/^[A-Z]{3}$/.test(currency) || currency === "THB") return { error: "รหัสสกุลเงินไม่ถูกต้อง" };
  if (!(rate > 0)) return { error: "อัตราต้องมากกว่า 0" };
  if (!reason) return { error: "กรุณาระบุเหตุผล" };

  const patch = { rate_to_thb: rate, source: "ADMIN_OVERRIDE", is_override: true, override_reason: reason, source_reference: null };
  const { data: existing } = await supabase.from("fx_rates").select("id")
    .eq("rate_date", rate_date).eq("currency", currency).eq("rate_type", "MID_AVERAGE").is("deleted_at", null).maybeSingle();
  const { error } = existing
    ? await supabase.from("fx_rates").update(patch).eq("id", existing.id)
    : await supabase.from("fx_rates").insert({ rate_date, currency, rate_type: "MID_AVERAGE", ...patch });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/settings/system");
  return { ok: `บันทึก ${currency} ${rate} ณ ${rate_date} แล้ว` };
}
