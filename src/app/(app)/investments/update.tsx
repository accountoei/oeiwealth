import { createClient } from "@/lib/supabase/server";
import UpdateBatch, { type UpdateRow } from "./update-batch";

type HV = { id: string; portfolio_asset_id: string; holding_type: string; name: string; symbol: string | null; currency: string;
  quantity: number | null; current_price: number | null; current_value: number | null; current_value_date: string | null;
  status: string; is_default_cash: boolean; sort_order: number | null };

/** ข้อมูลของแท็บ "อัปเดตยอดคงเหลือ" — หน้า Investments ดึงทันทีที่รู้รายชื่อพอร์ต พร้อมกับข้อมูลภาพรวม (30 ต.ค. 2026 · เดิมแท็บเริ่มดึงหลังภาพรวมเสร็จ) */
export async function loadUpdate(portfolios: { asset_id: string }[]) {
  const supabase = await createClient();
  const ids = portfolios.map((p) => p.asset_id);
  const { data: hs } = ids.length
    ? await supabase.from("v_holdings_active")
        .select("id,portfolio_asset_id,holding_type,name,symbol,currency,quantity,current_price,current_value,current_value_date,status,is_default_cash,sort_order")
        .in("portfolio_asset_id", ids).eq("status", "ACTIVE").order("sort_order").order("name")
    : { data: [] };
  const list = (hs as HV[] | null) ?? [];
  const { data: extra } = list.length
    ? await supabase.from("investment_holdings").select("id,auto_price,valuation_mode").in("id", list.map((h) => h.id))
    : { data: [] };
  return { list, extra };
}

/** แท็บ "อัปเดตยอดคงเหลือ": ราคา / ยอดตาม Statement ทุกพอร์ต (แบบเดียวกับแท็บอัปเดตยอดคงเหลือของ Cash & Bank) · data = ผลของ loadUpdate(portfolios) */
export function UpdateTab({ data, today, date, goLive, portfolios, canWrite }: {
  data: Awaited<ReturnType<typeof loadUpdate>>; today: string; date?: string; goLive: string; portfolios: { asset_id: string; name: string }[]; canWrite: boolean;
}) {
  const { list, extra } = data;
  const ex = new Map(((extra ?? []) as { id: string; auto_price: boolean | null; valuation_mode: string | null }[]).map((x) => [x.id, x]));
  const order = new Map(portfolios.map((p, i) => [p.asset_id, i]));
  const name = new Map(portfolios.map((p) => [p.asset_id, p.name]));
  const rows: UpdateRow[] = list
    // บัญชีเงินฝากที่ระบบสร้างให้ (ยอด 0 · ไม่ใช่บัญชีหลัก) ไม่ต้องแสดง
    .filter((h) => !(h.holding_type === "CASH" && !h.is_default_cash && !Number(h.current_value ?? 0)))
    .sort((a, b) => (order.get(a.portfolio_asset_id) ?? 0) - (order.get(b.portfolio_asset_id) ?? 0)
      || Number(b.holding_type === "CASH") - Number(a.holding_type === "CASH"))
    .map((h) => ({
      id: h.id, pf: h.portfolio_asset_id, pfName: name.get(h.portfolio_asset_id) ?? "", name: h.name, symbol: h.symbol,
      type: h.holding_type, currency: h.currency, qty: Number(h.quantity ?? 0),
      price: h.current_price == null ? null : Number(h.current_price), value: h.current_value == null ? null : Number(h.current_value),
      date: h.current_value_date, cash: h.holding_type === "CASH", lump: ex.get(h.id)?.valuation_mode === "LUMP_SUM",
      auto: !!ex.get(h.id)?.auto_price,
    }));
  // ?d=YYYY-MM-DD (เช่น ลิงก์จาก Month Closing) = วันที่ตั้งต้น · ไม่ถูกต้อง / เกินวันนี้ / ก่อน Go-live → วันนี้
  const start = /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") && date! <= today && (!goLive || date! >= goLive) ? date! : today;
  return <UpdateBatch key={start} rows={rows} today={today} initialDate={start} minDate={goLive} canWrite={canWrite} />;
}
