"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/format";

export type GoLiveState = { error?: string; ok?: string };

export async function confirmGoLive(_: GoLiveState, form: FormData): Promise<GoLiveState> {
  if (form.get("ack") !== "on") return { error: "กรุณาติ๊กยืนยันว่าเข้าใจผลของการ Go-live" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_go_live");
  if (error) {
    const missing = error.details ? (() => { try { return (JSON.parse(error.details) as unknown[]).length; } catch { return null; } })() : null;
    return { error: friendlyError(error.message) + (missing ? ` (${missing} รายการ)` : "") };
  }
  revalidatePath("/", "layout");
  const warnings = (data as { warnings?: unknown[] } | null)?.warnings?.length ?? 0;
  return { ok: `ระบบ LIVE แล้ว${warnings ? ` · มีรายการควรตรวจ ${warnings} รายการ` : ""}` };
}

/** เปลี่ยนวัน Go-live (ก่อน Confirm) — ระบบย้ายยอดตั้งต้นทุกประเภทไปวันก่อน Go-live ใหม่ให้ */
export async function changeGoLiveDate(_: GoLiveState, form: FormData): Promise<GoLiveState> {
  const ym = String(form.get("month") ?? "");
  if (!/^\d{4}-\d{2}$/.test(ym)) return { error: "กรุณาเลือกเดือนที่จะเริ่มใช้จริง" };
  if (form.get("ack") !== "on") return { error: "กรุณาติ๊กยืนยันว่าเข้าใจผลของการเปลี่ยนวัน" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("change_go_live_date", { p_new_date: `${ym}-01` });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/", "layout");
  const d = data as { changed?: boolean; moved?: Record<string, number> } | null;
  if (!d?.changed) return { ok: "วันเดิม — ไม่มีอะไรเปลี่ยน" };
  const n = Object.values(d.moved ?? {}).reduce((t, x) => t + Number(x ?? 0), 0);
  return { ok: `เปลี่ยนวัน Go-live แล้ว · ย้ายวันที่ของยอดตั้งต้น ${n} รายการ` };
}
