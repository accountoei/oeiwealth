"use server";

import { revalidatePath } from "@/lib/revalidate";
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

/** ADMIN เลือกแหล่งอัตรา (ธปท. / ธนาคารกรุงเทพ) — มีผลตั้งแต่วันนี้ ไม่แก้อัตราเดิม */
export async function setFxSource(_: FxState, form: FormData): Promise<FxState> {
  const source = String(form.get("source") ?? "");
  if (!["BOT", "BBL"].includes(source)) return { error: "กรุณาเลือกแหล่งอัตรา" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_fx_source", { p_source: source, p_bbl_rate: String(form.get("bbl_rate") ?? "") || null });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/settings/system");
  const d = data as { changed?: boolean; since?: string } | null;
  if (!d?.changed) return { ok: "ไม่มีอะไรเปลี่ยน" };
  return { ok: `เปลี่ยนแหล่งเป็น ${source === "BBL" ? "ธนาคารกรุงเทพ" : "ธปท."} แล้ว · มีผลตั้งแต่อัตราของวันที่ ${d.since}` };
}

/** ปุ่ม "อัปเดตอัตราตอนนี้" (ADMIN) → Edge Function fx-refresh สั่ง GitHub Actions รันงาน FX rates ทันที */
export async function refreshFxNow(): Promise<FxState> {
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke("fx-refresh", { body: {} });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try { msg = (await ctx.json()).error ?? msg; } catch { /* ไม่ใช่ JSON */ }
    }
    if (/Failed to send a request|not found|404/i.test(msg)) msg = "ยังไม่ได้ติดตั้ง Edge Function fx-refresh ใน Supabase";
    return { error: msg };
  }
  revalidatePath("/settings/system");
  const exp = (data as { token_expires?: string | null } | null)?.token_expires;
  return { ok: `สั่งอัปเดตแล้ว · ใช้เวลาราว 1–2 นาที แล้วกดรีเฟรชหน้านี้ (ดูผลที่ประวัติงานอัตโนมัติ)${exp ? ` · token หมดอายุ ${exp.slice(0, 10)}` : ""}` };
}

/** ADMIN ตั้งอัตราดอกเบี้ยเทียบของครอบครัว (ต้นทุนเสียโอกาส) — ใช้คิดราคาขายขั้นต่ำที่คุ้มของ Property · ไม่นับใน Net Worth */
export async function setOpportunityRate(_: FxState, form: FormData): Promise<FxState> {
  const raw = String(form.get("rate") ?? "").replace(/,/g, "").trim();
  const rate = raw === "" ? null : Number(raw);
  if (rate !== null && (Number.isNaN(rate) || rate < 0 || rate > 100)) return { error: "อัตราต้องอยู่ระหว่าง 0–100%" };
  const supabase = await createClient();
  const { data: family } = await supabase.from("families").select("id").maybeSingle();
  if (!family) return { error: "ไม่พบข้อมูลครอบครัว" };
  const { data, error } = await supabase.from("families").update({ opportunity_rate_pct: rate }).eq("id", family.id).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "เฉพาะผู้ดูแลระบบ (ADMIN) เท่านั้นที่แก้อัตรานี้ได้" };
  revalidatePath("/settings/system");
  revalidatePath("/property", "layout");
  return { ok: rate === null ? "ล้างอัตราแล้ว" : `บันทึกอัตรา ${rate}% ต่อปีแล้ว` };
}
