"use client";

import { createContext, useActionState, useContext, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";
import { AUDIT_LABEL, type FinYear } from "@/lib/biz-financials";
import { useRowPanel } from "@/components/RowPanel";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import AssetValuationForm from "@/components/AssetValuationForm";
import BarChartYears, { type BarSeries } from "@/components/BarChartYears";
import Flash from "@/components/Flash";
import { deleteFinancialYear, deletePastBusiness, saveFinancialYear, savePastBusiness, type ActionState } from "./actions";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const dv = (v: number | null | undefined) => (v == null ? "" : String(v));

/** เจ้าของแถว: กิจการ (asset) หรือบริษัทที่ปิดแล้ว (past) */
export type FinOwner = { assetId?: string; pastId?: string };
/** ปุ่ม "ใช้เป็นมูลค่า" (ส่วนของผู้ถือหุ้น × % ที่ครอบครัวถือ → มูลค่าตามบัญชี ณ 31 ธ.ค.) */
export type ValueHelp = { assetId: string; currency: string; pct: number; today: string; minDate: string; paths: string[] };

function Num({ name, label, v, plain }: { name: string; label: string; v: number | null | undefined; plain?: boolean }) {
  return <label className="text-sm">{label}
    <input name={name} inputMode={plain ? "numeric" : "decimal"} {...(plain ? { "data-plain": true } : {})} defaultValue={dv(v)} className={input} /></label>;
}

/** ฟอร์มผลประกอบการ 1 ปี (เพิ่ม / แก้) · ตัวเลขทั้งบริษัท 100% */
export function FinYearForm({ owner, row, nextYear, canDelete, value }: {
  owner: FinOwner; row?: FinYear; nextYear?: number; canDelete?: boolean; value?: ValueHelp;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveFinancialYear, {});
  const [del, delAction, delPending] = useActionState<ActionState, FormData>(deleteFinancialYear, {});
  const cf = useConfirmSubmit();
  const delId = `del-fin-${useId()}`;
  const be = row ? row.fiscal_year + 543 : nextYear != null ? nextYear + 543 : undefined;
  const hidden = <>
    {owner.assetId && <input type="hidden" name="asset_id" value={owner.assetId} />}
    {owner.pastId && <input type="hidden" name="past_business_id" value={owner.pastId} />}
  </>;
  const yearEnd = row ? `${row.fiscal_year}-12-31` : "";
  const canValue = !!(value && row?.equity != null && yearEnd <= value.today && (!value.minDate || yearEnd >= value.minDate));
  return (
    <div className="space-y-5">
      <form action={action} className="space-y-4">
        {hidden}
        {row && <input type="hidden" name="id" value={row.id} />}
        <h3 className="font-medium text-slate-900">{row ? `ผลประกอบการปี ${be}` : "เพิ่มผลประกอบการ"} <span className="text-xs font-normal text-slate-500">· ตัวเลขทั้งบริษัท (100%) · สิ้นงวด 31 ธ.ค.</span></h3>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm">ปีบัญชี (พ.ศ.) *<input name="fiscal_year_be" required inputMode="numeric" data-plain defaultValue={be ?? ""} readOnly={!!row}
            className={`${input} ${row ? "bg-slate-50" : ""}`} /></label>
          <label className="text-sm">สถานะงบ
            <select name="audit_status" defaultValue={row?.audit_status ?? "AUDITED"} className={input}>
              {Object.entries(AUDIT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></label>
          <label className="text-sm md:col-span-2">หมายเหตุ<input name="notes" placeholder="เช่น COVID-19" defaultValue={row?.notes ?? ""} className={input} /></label>
        </div>
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">ผลประกอบการ (บาท)</legend>
          <div className="grid gap-3 md:grid-cols-4">
            <Num name="revenue_domestic" label="รายได้ในประเทศ" v={row?.revenue_domestic} />
            <Num name="revenue_foreign" label="รายได้ต่างประเทศ" v={row?.revenue_foreign} />
            <Num name="net_profit" label="กำไร (ขาดทุน) สุทธิ" v={row?.net_profit} />
            <Num name="income_tax" label="ภาษีเงินได้นิติบุคคล" v={row?.corporate_tax} />
            <Num name="dividends_paid" label="จ่ายเงินปันผล (ทั้งบริษัท)" v={row?.dividends_paid} />
            <Num name="equity" label="ส่วนของผู้ถือหุ้น ณ สิ้นปี" v={row?.equity} />
            <Num name="employees" label="พนักงาน (คน · รวมผู้บริหาร)" v={row?.employees} plain />
            <Num name="executives" label="ผู้บริหาร (คน)" v={row?.executives} plain />
          </div>
          <p className="mt-2 text-xs text-slate-500">ขาดทุน ใส่เครื่องหมายลบ เช่น -2,080,644 · รายได้รวม / กำไรสะสม / เฉพาะพนักงาน ระบบคำนวณให้</p>
        </fieldset>
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">สินทรัพย์ถาวร ณ 31 ธ.ค. (ไม่บังคับ)</legend>
          <div className="grid gap-3 md:grid-cols-5">
            <Num name="land_value" label="ที่ดิน" v={row?.land_value} />
            <Num name="building_cost" label="อาคาร · มูลค่า" v={row?.building_cost} />
            <Num name="building_depreciation" label="อาคาร · ค่าเสื่อมสะสม" v={row?.building_depreciation} />
            <Num name="equipment_cost" label="ยานพาหนะ / เครื่องจักร · มูลค่า" v={row?.equipment_cost} />
            <Num name="equipment_depreciation" label="ยานพาหนะ / เครื่องจักร · ค่าเสื่อมสะสม" v={row?.equipment_depreciation} />
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
          {row && canDelete && <button form={delId} disabled={delPending} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">{delPending ? "กำลังลบ…" : "ลบปีนี้"}</button>}
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {del.error && <span className="text-sm text-red-600">{del.error}</span>}
          <Flash on={state} as="span" className="text-sm text-emerald-700" />
          <Flash on={del} as="span" className="text-sm text-emerald-700" />
        </div>
      </form>
      {row && canDelete && (<>
        {cf.dialog}
        <form id={delId} action={delAction} onSubmit={cf.guard(`ลบผลประกอบการปี ${be}?`, { danger: true, okLabel: "ลบ" })}>
          {hidden}<input type="hidden" name="id" value={row.id} />
        </form>
      </>)}
      {canValue && value && row?.equity != null && (
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <h4 className="text-sm font-medium text-slate-800">ใช้เป็นมูลค่าของครอบครัว</h4>
          <p className="text-xs text-slate-500">ส่วนของผู้ถือหุ้น {money(row.equity)} × ที่ครอบครัวถือ {value.pct.toLocaleString("th-TH", { maximumFractionDigits: 4 })}% = มูลค่าตามบัญชี ณ 31 ธ.ค. {be} · ตรวจ / แก้ได้ก่อนกดบันทึก</p>
          <AssetValuationForm assetId={value.assetId} currency={value.currency} today={value.today} minDate={value.minDate} paths={value.paths}
            methods={[["BOOK_VALUE", "มูลค่าตามบัญชี"], ["USER_ESTIMATE", "ประมาณเอง"]]} defaultDate={yearEnd}
            defaultValue={Math.round(row.equity * value.pct) / 100} defaultNotes={`ส่วนของผู้ถือหุ้นปี ${be} × ${value.pct}%`} />
        </div>
      )}
    </div>
  );
}

/** กดแถวของปี → pop up แก้ไข (วางในเซลล์ของแถว) */
export function FinYearEdit(props: { owner: FinOwner; row: FinYear; canDelete: boolean; value?: ValueHelp }) {
  const panel = useRowPanel(true);
  return panel.render(<FinYearForm {...props} />, undefined, "lg");
}

/** บริษัทที่ปิดแล้ว: เพิ่ม / แก้ข้อมูลบริษัท */
export function PastBusinessForm({ row, canDelete }: {
  row?: { id: string; name: string; company_name: string | null; established_date: string | null; closed_date: string | null; notes: string | null };
  canDelete?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(savePastBusiness, {});
  const [del, delAction, delPending] = useActionState<ActionState, FormData>(deletePastBusiness, {});
  const cf = useConfirmSubmit();
  const delId = `del-past-${useId()}`;
  return (
    <div>
      <form action={action} className="grid gap-3 md:grid-cols-2">
        {row && <input type="hidden" name="id" value={row.id} />}
        <h3 className="font-medium text-slate-900 md:col-span-2">{row ? "แก้ไขบริษัทที่ปิดแล้ว" : "เพิ่มบริษัทที่ปิดแล้ว"}
          <span className="block text-xs font-normal text-slate-500">เก็บเป็นประวัติผลประกอบการ · ไม่ใช่ทรัพย์สิน ไม่นับในความมั่งคั่งสุทธิ</span></h3>
        <label className="text-sm">ชื่อย่อ *<input name="name" required maxLength={100} placeholder="เช่น KIP" defaultValue={row?.name ?? ""} className={input} /></label>
        <label className="text-sm">ชื่อบริษัท<input name="company_name" maxLength={200} defaultValue={row?.company_name ?? ""} className={input} /></label>
        <label className="text-sm">วันที่จัดตั้ง<input name="established_date" type="date" defaultValue={row?.established_date ?? ""} className={input} /></label>
        <label className="text-sm">วันที่ปิดกิจการ<input name="closed_date" type="date" defaultValue={row?.closed_date ?? ""} className={input} /></label>
        <label className="text-sm md:col-span-2">หมายเหตุ<input name="notes" maxLength={2000} defaultValue={row?.notes ?? ""} className={input} /></label>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
          {row && canDelete && <button form={delId} disabled={delPending} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">{delPending ? "กำลังลบ…" : "ลบบริษัทนี้"}</button>}
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {del.error && <span className="text-sm text-red-600">{del.error}</span>}
          <Flash on={state} as="span" className="text-sm text-emerald-700" />
        </div>
      </form>
      {row && canDelete && (<>
        {cf.dialog}
        <form id={delId} action={delAction} onSubmit={cf.guard(`ลบบริษัท ${row.name} และผลประกอบการทุกปีของบริษัทนี้?`, { danger: true, okLabel: "ลบ" })}>
          <input type="hidden" name="id" value={row.id} />
        </form>
      </>)}
    </div>
  );
}

/* ---------------------------------------------------------------- กราฟ */
const DOM = "#2563eb", FOR = "#7dd3fc", PROFIT = "#059669", LOSS = "#dc2626";

export type CoSeries = { key: string; label: string; color: string; revenue: (number | null)[]; profit: (number | null)[] };

/** กราฟรายได้ (แท่งซ้อน ในประเทศ + ต่างประเทศ · กลุ่ม: สลับเป็นแยกตามบริษัทได้) + กราฟกำไร (ขาดทุน) แกนปีเดียวกัน */
/** ค่าเฉลี่ยเคลื่อนที่ 3 ปี (ปีนั้น + 2 ปีก่อนหน้า) · ขาดปีใดปีหนึ่ง = null */
function movingAvg(v: (number | null)[], k = 3): (number | null)[] {
  return v.map((_, i) => {
    if (i < k - 1) return null;
    const w = v.slice(i - k + 1, i + 1);
    return w.every((x) => x != null) ? (w as number[]).reduce((t, x) => t + x, 0) / k : null;
  });
}

export function ResultsCharts(all: {
  years: number[]; domestic: (number | null)[]; foreign: (number | null)[]; profit: (number | null)[];
  /** มี = ภาพรวมกลุ่ม (ปุ่มสลับ "แยกตามบริษัท") */ companies?: CoSeries[]; events?: Record<number, string[]>;
}) {
  const [by, setBy] = useState<"origin" | "company">("origin");
  const { range, trend } = useContext(ViewCtx);
  const n = range && all.years.length > range ? range : all.years.length;
  const cut = <T,>(a: T[]) => a.slice(a.length - n);
  // เส้นเฉลี่ย 3 ปี: คิดจากทุกปีก่อนตัดช่วง (ปีแรกของช่วงยังเฉลี่ยกับปีก่อนหน้าได้) · ต้องมีครบ 3 ปีติดกัน
  const revTotal = all.years.map((_, i) => (all.domestic[i] == null && all.foreign[i] == null ? null : (all.domestic[i] ?? 0) + (all.foreign[i] ?? 0)));
  const revAvg = trend ? cut(movingAvg(revTotal)) : undefined, proAvg = trend ? cut(movingAvg(all.profit)) : undefined;
  const years = cut(all.years), domestic = cut(all.domestic), foreign = cut(all.foreign), profit = cut(all.profit), events = all.events;
  const companies = all.companies?.map((c) => ({ ...c, revenue: cut(c.revenue), profit: cut(c.profit) }))
    .filter((c) => c.revenue.some((v) => v != null) || c.profit.some((v) => v != null));
  const split = by === "company" && companies && companies.length > 0;
  const rev: BarSeries[] = split
    ? companies!.map((c) => ({ key: c.key, label: c.label, color: c.color, values: c.revenue }))
    : [{ key: "d", label: "รายได้ในประเทศ", color: DOM, values: domestic }, { key: "f", label: "รายได้ต่างประเทศ", color: FOR, values: foreign }];
  const pro: BarSeries[] = split
    ? companies!.map((c) => ({ key: c.key, label: c.label, color: c.color, values: c.profit }))
    : [{ key: "p", label: "กำไร (ขาดทุน)", color: PROFIT, negColor: LOSS, values: profit }];
  const tab = (k: "origin" | "company", l: string) => (
    <button type="button" onClick={() => setBy(k)} aria-pressed={by === k}
      className={`rounded-md px-2.5 py-1 text-xs ${by === k ? "bg-slate-800 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>{l}</button>
  );
  return (
    <div className="space-y-4">
      {companies && companies.length > 0 && <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">แสดงรายได้ {tab("origin", "ในประเทศ / ต่างประเทศ")}{tab("company", "แยกตามบริษัท")}</div>}
      <div>
        <h3 className="mb-1 text-sm font-medium text-slate-700">รายได้ (บาท)</h3>
        <BarChartYears title="รายได้" years={years} series={rev} events={events} trend={revAvg} />
      </div>
      <div>
        <h3 className="mb-1 text-sm font-medium text-slate-700">กำไร (ขาดทุน) (บาท)</h3>
        <BarChartYears title="กำไร (ขาดทุน)" years={years} series={pro} height={170} total={split} trend={proAvg} />
      </div>
    </div>
  );
}

/** เลือกปีของตารางสินทรัพย์ถาวร (ภาพรวมกลุ่ม) */
export function FixedYearSelect({ years, value }: { years: number[]; value: number }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">ณ 31 ธ.ค.
      <select value={value} onChange={(e) => router.push(`/financial/business?tab=results&fy=${e.target.value}`, { scroll: false })}
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
        {years.map((y) => <option key={y} value={y}>{y + 543}</option>)}
      </select>
    </label>
  );
}


/* ---------------------------------------------------------------- ช่วงปี + หน่วย (ตกลง 9 พ.ย. 2026 รอบ 2)
   ResultsView ครอบกราฟ + ตาราง: เลือก 3 / 5 / 10 ปี / ทั้งหมด (ค่าเริ่มต้น 10) · หน่วย ล้านบาท / บาท
   ตารางเป็น server component → ซ่อนแถว / สลับหน่วยด้วย data-r / data-u ของกล่องนี้ (group/v) */
export type Range = 3 | 5 | 10 | 0;
/** ช่วงปี + เส้นเฉลี่ย 3 ปี (เปิด / ปิด · 9 พ.ย. 2026) ที่กราฟใช้ */
const ViewCtx = createContext<{ range: Range; trend: boolean }>({ range: 10, trend: true });

export function ResultsView({ children, years, charts }: { children: React.ReactNode; /** จำนวนปีที่มีข้อมูล (ซ่อนปุ่มที่ไม่จำเป็น) */ years: number;
  /** มีกราฟ → แสดงปุ่มเส้นเฉลี่ย 3 ปี */ charts?: boolean }) {
  const [r, setR] = useState<Range>(10);
  const [u, setU] = useState<"m" | "b">("m");
  const [t, setT] = useState(true);
  const seg = <T,>(cur: T, v: T, l: string, set: (v: T) => void) => (
    <button key={l} type="button" onClick={() => set(v)} aria-pressed={cur === v}
      className={`px-2.5 py-1 text-xs ${cur === v ? "bg-slate-800 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}>{l}</button>
  );
  const ranges = ([[3, "3 ปี"], [5, "5 ปี"], [10, "10 ปี"]] as [Range, string][]).filter(([n]) => n < years);
  return (
    <ViewCtx.Provider value={{ range: r, trend: t }}>
      <div className="group/v space-y-4" data-r={years <= r || r === 0 ? "all" : r} data-u={u}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
          {ranges.length > 0 && <span className="flex items-center gap-2">ช่วง
            <span className="inline-flex divide-x divide-slate-300 overflow-hidden rounded-md border border-slate-300">
              {ranges.map(([n, l]) => seg(r, n, l, setR))}{seg(r, 0 as Range, `ทั้งหมด (${years} ปี)`, setR)}
            </span></span>}
          <span className="flex items-center gap-2">หน่วย
            <span className="inline-flex divide-x divide-slate-300 overflow-hidden rounded-md border border-slate-300">
              {seg(u, "m" as const, "ล้านบาท", setU)}{seg(u, "b" as const, "บาท", setU)}
            </span></span>
          {charts && years >= 3 && <span className="flex items-center gap-2">เส้นเฉลี่ย 3 ปี
            <span className="inline-flex divide-x divide-slate-300 overflow-hidden rounded-md border border-slate-300">
              {seg(t, true, "แสดง", setT)}{seg(t, false, "ซ่อน", setT)}
            </span></span>}
        </div>
        {children}
      </div>
    </ViewCtx.Provider>
  );
}
