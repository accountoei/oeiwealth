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
