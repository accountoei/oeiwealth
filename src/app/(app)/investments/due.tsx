import { createClient } from "@/lib/supabase/server";
import { monthRange } from "@/lib/format";
import { scheduleOf, type DueRow } from "@/lib/coupon-schedule";
import type { Bank } from "./[id]/forms";
import { recEdit, recLabel, recLink, type Recorded } from "@/lib/recorded-edit";
import { portfolioTxFields } from "@/lib/source-edit";
import DueBatch, { type DueGroup, type PfCash } from "./due-batch";
import { activeBanks } from "@/lib/pay-sources";

// แท็บ "บันทึกรับผลตอบแทน" (หน้า Investments) · งวดในตารางของหน้าหลักทรัพย์ใช้ชื่องวด dueLabel ร่วมกัน
//   ดอกเบี้ย / Coupon และเงินต้นที่ครบกำหนดในเดือนที่เลือก (ทุกพอร์ตในตารางเดียว) · งวดที่เลยกำหนดแล้วยังไม่บันทึก = ค้างรับ (ขึ้นก่อน · รวมงวดของเดือนก่อน ๆ) · หลังวันนี้ = รอรับ (ยังไม่ถึงกำหนด)
//   ตารางคำนวณจากข้อมูลหลักทุกครั้ง (src/lib/coupon-schedule.ts) · ช่องกรอก / บันทึกหลายรายการพร้อมกันอยู่ใน due-batch.tsx

export const dueLabel = (r: DueRow) => (r.kind === "PRINCIPAL" ? "เงินต้นครบกำหนด" : r.total > 1 ? `ดอกเบี้ย งวด ${r.no}/${r.total}` : "ดอกเบี้ย (ตอนครบกำหนด)");

type HRow = { id: string; name: string; holding_type: string; currency: string; status: string; maturity_date: string | null;
  current_value: number | null; face_value: number | null; interest_rate: number | null; coupon_frequency: string | null;
  income_cash_holding_id: string | null; income_bank_asset_id: string | null;
  investment_portfolios: { asset_id: string; assets: { name: string } | null } | null };
type Fcn = { holding_id: string; principal: number | null; coupon_rate: number | null; coupon_frequency: string | null; issue_date: string | null; trade_date: string | null };
type Tx = { id: string; holding_id: string; transaction_type: string; transaction_date: string; amount: number | null;
  settlement_date: string | null; settle_to_asset_id: string | null; fee: number | null;
  tax: number | null; notes: string | null; cash_movement_id: string | null };
type CRow = { id: string; name: string; currency: string; is_default_cash: boolean; interest_rate: number | null; current_value: number | null;
  investment_portfolios: { asset_id: string; assets: { name: string } | null } | null };

/** ข้อมูลของแท็บ "บันทึกรับผลตอบแทน" — หน้า Investments ดึงพร้อมกับข้อมูลภาพรวม (30 ต.ค. 2026)
 *  เดิมแท็บเริ่มดึงหลังภาพรวมเสร็จ แล้วรอต่อกันอีก 3 ทอด → ตอนนี้ 2 สายดึงพร้อมกัน สายละ 2 ทอด:
 *  ตราสารที่มีวันครบกำหนด → ข้อมูล FCN + รายการรับ · บัญชีเงินฝากในพอร์ต → ดอกเบี้ยที่รับแล้วในเดือนที่เลือก */
export async function loadDue(month: string, canWrite: boolean, showAsset: (assetId: string) => boolean) {
  const supabase = await createClient();
  const none = Promise.resolve({ data: [] as never[] });
  const { start, end } = monthRange(month);
  const [{ holdings, fcns, txs }, { cashRows, cashInt }, { data: banks }] = await Promise.all([
    (async () => {
      const { data: hs } = await supabase.from("investment_holdings")
        .select("id,name,holding_type,currency,status,maturity_date,current_value,face_value,interest_rate,coupon_frequency,income_cash_holding_id,income_bank_asset_id,investment_portfolios!inner(asset_id,deleted_at,assets(name))")
        .in("holding_type", ["BOND", "FCN", "STRUCTURED_PRODUCT", "OTHER"]).not("maturity_date", "is", null)
        .is("deleted_at", null).is("investment_portfolios.deleted_at", null);
      const holdings = ((hs as unknown as HRow[] | null) ?? []).filter((h) => h.investment_portfolios && showAsset(h.investment_portfolios.asset_id));
      const ids = holdings.map((h) => h.id);
      const [{ data: fcns }, { data: txs }] = await Promise.all([
        ids.length ? supabase.from("fcn_details").select("holding_id,principal,coupon_rate,coupon_frequency,issue_date,trade_date").in("holding_id", ids).is("deleted_at", null) : none,
        ids.length ? supabase.from("investment_transactions").select("id,holding_id,transaction_type,transaction_date,settlement_date,settle_to_asset_id,amount,fee,tax,notes,cash_movement_id").in("holding_id", ids)
          .in("transaction_type", ["OPENING_BALANCE", "BUY", "COUPON", "INTEREST", "MATURITY"]).is("deleted_at", null) : none,
      ]);
      return { holdings, fcns, txs };
    })(),
    // ดอกเบี้ยเงินฝากในพอร์ต: รับแล้วในเดือนที่เลือก (สุทธิหลังภาษี)
    (async () => {
      const { data: cash } = await supabase.from("investment_holdings").select("id,name,currency,is_default_cash,interest_rate,current_value,investment_portfolios!inner(asset_id,deleted_at,assets(name))")
        .eq("holding_type", "CASH").eq("status", "ACTIVE").is("deleted_at", null).is("investment_portfolios.deleted_at", null).order("created_at");
      const cashRows = ((cash as unknown as CRow[] | null) ?? []).filter((c) => c.investment_portfolios && showAsset(c.investment_portfolios.asset_id));
      const { data: cashInt } = cashRows.length ? await supabase.from("investment_transactions").select("id,holding_id,transaction_type,transaction_date,settlement_date,settle_to_asset_id,amount,tax,fee,notes,cash_movement_id")
        .in("holding_id", cashRows.map((c) => c.id)).eq("transaction_type", "INTEREST").gte("transaction_date", start).lte("transaction_date", end).is("deleted_at", null)
        : { data: [] as Tx[] };
      return { cashRows, cashInt };
    })(),
    canWrite ? activeBanks(supabase) : none,
  ]);
  return { holdings, fcns, txs, cashRows, cashInt, banks };
}

/** แท็บ "บันทึกรับผลตอบแทน" (data = ผลของ loadDue) */
export function DueTab({ data, month, today, goLive, canWrite, canDelete }: {
  data: Awaited<ReturnType<typeof loadDue>>; month: string; today: string; goLive: string; canWrite: boolean; canDelete: boolean;
}) {
  // วันที่ตั้งต้นของฟอร์มบันทึกรับ = วันรับตามตาราง (ยังไม่ถึง → วันนี้ · ก่อน Go-live → วัน Go-live) · แก้ได้ในฟอร์ม
  const dueDefault = (due: string) => (due > today ? today : due < goLive ? goLive : due);
  const { holdings, fcns, txs, cashRows, cashInt, banks } = data;
  const fcnOf = new Map(((fcns as Fcn[] | null) ?? []).map((f) => [f.holding_id, f]));
  const txOf = new Map<string, Tx[]>();
  ((txs as Tx[] | null) ?? []).forEach((t) => txOf.set(t.holding_id, [...(txOf.get(t.holding_id) ?? []), t]));

  const { start, end } = monthRange(month);
  const curMonth = today.slice(0, 7);
  // เดือนที่เลือก + งวดที่เลยกำหนดยังไม่รับ (เมื่อดูเดือนนี้หรือเดือนข้างหน้า)
  const items = holdings.flatMap((h) => scheduleOf(h, fcnOf.get(h.id) ?? null, txOf.get(h.id) ?? []).map((r) => ({ r, h })))
    .filter(({ r }) => (r.due >= start && r.due <= end) || (month >= curMonth && !r.received && r.due < start && r.due >= goLive));
  const late = (r: DueRow) => !r.received && r.due < today;
  items.sort((a, b) => Number(late(b.r)) - Number(late(a.r)) || a.r.due.localeCompare(b.r.due) || a.h.name.localeCompare(b.h.name));
  const groups = new Map<string, { name: string; rows: typeof items }>();
  items.forEach((x) => {
    const pf = x.h.investment_portfolios!;
    const g = groups.get(pf.asset_id) ?? { name: pf.assets?.name ?? "พอร์ต", rows: [] };
    g.rows.push(x); groups.set(pf.asset_id, g);
  });
  // รับแล้ว → กดยอดเพื่อแก้ / ลบ (ฟอร์มเดียวกับประวัติของหลักทรัพย์ · ผ่านบัญชีธนาคาร = แก้ที่หน้าหลักทรัพย์ไม่ได้ → ลิงก์)
  const txById = new Map(((txs as Tx[] | null) ?? []).map((t) => [t.id, t]));
  const paths = ["/investments", "/income-expenses", "/financial/cash"];
  const txEdit = (t: Tx, pf: string, ccy: string, verb: string, net: boolean): Recorded => {
    const amt = Number(t.amount ?? 0) - (net ? Number(t.tax ?? 0) : 0);
    const lbl = recLabel(verb, t.transaction_date, amt, ccy);
    return { id: t.id, node: t.cash_movement_id ? recLink(lbl, `/investments/${pf}/holding/${t.holding_id}`) : recEdit({
      canWrite, canDelete, label: lbl, table: "investment_transactions", id: t.id, paths: [...paths, `/investments/${pf}`],
      deleteNote: "รายได้ / เงินเข้าออกบัญชีที่ระบบสร้างจากรายการนี้จะถูกลบตาม",
      fields: portfolioTxFields({ ...t, amount: t.amount ?? 0 }, !!t.settle_to_asset_id) }) };
  };
  const dueGroups: DueGroup[] = [...groups.entries()].map(([pf, g]) => ({ pf, name: g.name, rows: g.rows.map(({ r, h }) => ({
    key: r.key, kind: r.kind, label: dueLabel(r), due: r.due, expected: r.expected, received: r.received, defaultDate: dueDefault(r.due),
    edit: r.received?.id && txById.has(r.received.id) ? [txEdit(txById.get(r.received.id)!, pf, h.currency, "ได้รับ", false)] : undefined,
    holding: { id: h.id, name: h.name, holding_type: h.holding_type, currency: h.currency, status: h.status,
      income_cash_holding_id: h.income_cash_holding_id, income_bank_asset_id: h.income_bank_asset_id } })) }));
  // ดอกเบี้ยเงินฝากในพอร์ต: รับแล้วในเดือนที่เลือก (สุทธิหลังภาษี)
  const gotOf = new Map<string, number>();
  (cashInt ?? []).forEach((t) => gotOf.set(t.holding_id, (gotOf.get(t.holding_id) ?? 0) + Number(t.amount ?? 0) - Number(t.tax ?? 0) - Number(t.fee ?? 0)));
  const pfCash: PfCash[] = cashRows.map((c) => ({ id: c.id, name: c.name, currency: c.currency, is_default_cash: c.is_default_cash,
    pf: c.investment_portfolios!.asset_id, pfName: c.investment_portfolios!.assets?.name ?? "พอร์ต",
    rate: c.interest_rate == null ? null : Number(c.interest_rate), received: gotOf.get(c.id) ?? 0,
    edits: (cashInt ?? []).filter((t) => t.holding_id === c.id).sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
      .map((t) => txEdit(t as Tx, c.investment_portfolios!.asset_id, c.currency, "รับแล้ว", true)) }))
    // บัญชีที่ระบบสร้างให้แต่ไม่มีเงิน ไม่มีอัตรา และไม่ได้รับดอกเบี้ยเดือนนี้ → ไม่แสดง (ไม่มีดอกเบี้ยให้รับ)
    .filter((c) => c.rate != null || c.received !== 0 || Math.abs(Number(cashRows.find((x) => x.id === c.id)?.current_value ?? 0)) >= 0.005)
    .sort((a, b) => a.pfName.localeCompare(b.pfName, "th"));

  return (
    <div className="space-y-4">
      {/* ตัวเลือกเดือนอยู่ที่แถบบนของหน้า Investments (28 ต.ค. 2026) */}
      {groups.size === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
          ไม่มีรายการที่ต้องรับในเดือนนี้ · หุ้นกู้จะขึ้นที่นี่เมื่อใส่วันครบกำหนด + เงินต้น + อัตรา + จ่ายทุก ในหน้าแก้ไขข้อมูลของหลักทรัพย์
        </p>
      )}
      <DueBatch groups={dueGroups} cash={pfCash} banks={(banks as Bank[] | null) ?? []} today={today} minDate={goLive}
        defaultDate={end < today ? end : today} canWrite={canWrite}
        info="ดอกเบี้ย / Coupon · เงินต้นครบกำหนด · ดอกเบี้ยเงินฝากในพอร์ต · ทุกพอร์ตในตารางเดียว · ตั้งข้อมูลที่หลักทรัพย์ → แก้ไขข้อมูล (เงินต้น · อัตรา · จ่ายทุก)" />
    </div>
  );
}
