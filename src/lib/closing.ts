import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { monthRange, todayBangkok } from "@/lib/format";

/** เดือนที่ถึงเวลาปิดแล้วแต่ยังไม่ปิด ("2026-10") หรือ null — ใช้แสดงจุดแดงที่เมนู Settings / แท็บ Month Closing (เงื่อนไขเดียวกับป้ายแดง "ปิดเดือน" หน้าแรก) */
export const monthToClose = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const [{ data: family }, { data: last }] = await Promise.all([
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    supabase.from("net_worth_snapshots").select("snapshot_month").eq("status", "FINAL").is("deleted_at", null)
      .order("snapshot_month", { ascending: false }).limit(1),
  ]);
  if (!family?.go_live_date || family.system_status !== "LIVE") return null;
  const lastFinal = last?.[0]?.snapshot_month?.slice(0, 7);
  const ym = lastFinal ? monthRange(lastFinal).next : family.go_live_date.slice(0, 7);
  return monthRange(ym).end < todayBangkok() ? ym : null;
});
