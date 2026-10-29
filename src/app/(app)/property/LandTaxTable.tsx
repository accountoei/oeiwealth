"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { money } from "@/lib/format";
import { useActionSlot } from "@/components/ActionBar";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { useOnMainTab } from "../income-expenses/tabs";
import { CopyTaxYear, TaxLineForm, TaxYearSelect, type TaxLine } from "./[id]/LandTax";
import { copyTaxYearAll, type ActionState } from "./actions";
import Flash from "@/components/Flash";

export type TaxLineRow = TaxLine & { total_value: number; taxable_value: number; tax_amount: number };
export type TaxPropRow = {
  assetId: string; name: string; type: string; typeLabel: string; usage: string; usageLabel: string; loc: string | null; status: string;
  lines: TaxLineRow[]; hasPrev: boolean; rate: number; landSqWa: number | null;
};

const STATUS: Record<string, string> = { ACTIVE: "ถืออยู่", SOLD: "ขายแล้ว", GIFTED: "ยกให้แล้ว", LOST: "สูญหาย", CLOSED: "ปิดแล้ว" };
const small = "ml-2 rounded-md border border-slate-300 px-2 py-1 text-sm";
const sumOf = (ls: TaxLineRow[], k: "total_value" | "exemption" | "taxable_value" | "tax_amount") => ls.reduce((t, l) => t + Number(l[k] ?? 0), 0);

/** ตารางภาษีที่ดินทุกทรัพย์สิน (ปีที่เลือก) + ตัวกรอง + แก้ไขรายทรัพย์สิน + คัดลอกจากปีก่อนทั้งหมด */
export default function LandTaxTable({ rows, year, years, dataYears, hrefOf, canWrite, canDelete, note }: {
  rows: TaxPropRow[]; year: number; years: number[]; dataYears: number[]; hrefOf: string; canWrite: boolean; canDelete: boolean; note?: string;
}) {
  const [type, setType] = useState("");
  const [usage, setUsage] = useState("");
  const [loc, setLoc] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  useOnMainTab(() => { setType(""); setUsage(""); setLoc(""); setStatus("ACTIVE"); });
  const types = useMemo(() => [...new Map(rows.map((r) => [r.type, r.typeLabel]))], [rows]);
  const usages = useMemo(() => [...new Map(rows.map((r) => [r.usage, r.usageLabel]))], [rows]);
  const locs = useMemo(() => [...new Set(rows.map((r) => r.loc ?? ""))].sort((a, b) => (a ? a.localeCompare(b, "th") : 1)), [rows]);
  const statuses = useMemo(() => [...new Set(["ACTIVE", ...rows.map((r) => r.status)])], [rows]);
  const shown = rows.filter((r) => (!type || r.type === type) && (!usage || r.usage === usage)
    && (!loc || (loc === "__none" ? !r.loc : r.loc === loc)) && (!status || r.status === status));
  const all = shown.flatMap((r) => r.lines);
  const prev = year - 1;
  const copyIds = rows.filter((r) => r.hasPrev && r.lines.length === 0).map((r) => r.assetId);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
        <div>
          <h2 className="font-medium text-slate-900">ภาษีที่ดินและสิ่งปลูกสร้าง ปี {year + 543}</h2>
          {note && <p className="text-xs text-slate-500">{note}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TaxYearSelect years={years} value={year} withData={dataYears} hrefOf={hrefOf} />
          {canWrite && copyIds.length > 0 && <CopyAll from={prev} to={year} ids={copyIds} />}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 px-4 pt-3 text-xs text-slate-600">
        <label>ประเภท
          <select value={type} onChange={(e) => setType(e.target.value)} className={small}>
            <option value="">ทั้งหมด</option>{types.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>การใช้งาน
          <select value={usage} onChange={(e) => setUsage(e.target.value)} className={small}>
            <option value="">ทั้งหมด</option>{usages.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {locs.length > 1 && (
          <label>กลุ่มทำเล
            <select value={loc} onChange={(e) => setLoc(e.target.value)} className={small}>
              <option value="">ทั้งหมด</option>
              {locs.map((g) => <option key={g || "__none"} value={g || "__none"}>{g || "(ไม่ระบุ)"}</option>)}
            </select>
          </label>
        )}
        <label>สถานะ
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={small}>
            <option value="">ทั้งหมด</option>{statuses.map((s) => <option key={s} value={s}>{STATUS[s] ?? s}</option>)}
          </select>
        </label>
      </div>
      <table className="mt-3 w-full min-w-[48rem] text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr><th className="px-3 py-2">ทรัพย์สิน</th><th className="px-3 text-right">รวมราคาประเมิน</th><th className="px-3 text-right">ยกเว้น</th>
            <th className="px-3 text-right">ฐานภาษี</th><th className="px-3 text-right">ภาษีประจำปี</th><th className="px-3"></th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {shown.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">{rows.length ? "ไม่มีทรัพย์สินตามตัวกรอง" : "ยังไม่มีทรัพย์สิน"}</td></tr>}
          {shown.map((r) => (
            <tr key={r.assetId} className={`align-top ${r.status !== "ACTIVE" ? "opacity-60" : ""}`}>
              <td className="px-3 py-2"><Link href={`/property/${r.assetId}?ty=${year}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                <div className="text-xs text-slate-500">{[r.typeLabel, r.usageLabel, r.loc].filter(Boolean).join(" · ")}{r.lines.length > 1 && ` · ${r.lines.length} รายการ`}</div></td>
              {r.lines.length ? <>
                <td className="px-3 py-2 text-right tabular-nums">{money(sumOf(r.lines, "total_value"))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{sumOf(r.lines, "exemption") !== 0 ? money(-sumOf(r.lines, "exemption")) : "-"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(sumOf(r.lines, "taxable_value"))}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{money(sumOf(r.lines, "tax_amount"))}</td>
              </> : <td colSpan={4} className="px-3 py-2 text-right text-xs text-amber-700">ยังไม่ได้ใส่ข้อมูลภาษีปีนี้</td>}
              <td className="whitespace-nowrap px-3 py-2 text-right">
                {canWrite && <PropertyTaxEditor row={r} year={year} canDelete={canDelete} />}
              </td>
            </tr>
          ))}
        </tbody>
        {all.length > 0 && (
          <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
            <tr><td className="px-3 py-2">รวม{shown.length !== rows.length ? "ตามตัวกรอง" : ""}</td>
              <td className="px-3 text-right tabular-nums">{money(sumOf(all, "total_value"))}</td>
              <td className="px-3 text-right tabular-nums">{money(-sumOf(all, "exemption"))}</td>
              <td className="px-3 text-right tabular-nums">{money(sumOf(all, "taxable_value"))}</td>
              <td className="px-3 text-right tabular-nums">{money(sumOf(all, "tax_amount"))}</td><td></td></tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** แก้ไขภาษีของทรัพย์สิน 1 รายการ (ปีที่เลือก): รายการภาษีทั้งหมด · แก้ไข (ลบอยู่ข้างใน) · เพิ่ม · คัดลอกจากปีก่อน */
function PropertyTaxEditor({ row, year, canDelete }: { row: TaxPropRow; year: number; canDelete: boolean }) {
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "lg" });
  const trigger = <button type="button" onClick={() => setOpen(!open)}
    className={activeCls("rounded-md bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700")}>แก้ไข</button>;
  if (!open) return trigger;
  const ls = row.lines;
  return present(trigger, (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-slate-900">ภาษีที่ดิน · {row.name} · ปี {year + 543}</h3>
          <p className="text-xs text-slate-500">ภาษีรวม <b className="tabular-nums text-slate-700">{money(sumOf(ls, "tax_amount"))}</b> · {ls.length} รายการ</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ls.length === 0 && row.hasPrev && <CopyTaxYear assetId={row.assetId} from={year - 1} to={year} />}
          <TaxLineForm assetId={row.assetId} year={year} label="+ เพิ่มรายการ" primary
            defaults={{ rate_pct: Number(ls.at(-1)?.rate_pct ?? row.rate), land_sq_wa: ls.some((t) => t.land_sq_wa != null) ? null : row.landSqWa, sort_order: ls.length + 1 }} />
        </div>
      </div>
      {ls.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการภาษีปีนี้</p> : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr className="border-b border-slate-100"><th className="py-1.5">รายการ</th><th className="text-right">รวมราคาประเมิน</th><th className="text-right">ฐานภาษี</th>
              <th className="text-right">อัตรา</th><th className="text-right">ภาษี</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ls.map((t) => (
              <tr key={t.id}>
                <td className="py-2">{t.description || "-"}{t.building_type && <div className="text-xs text-slate-500">{t.building_type}</div>}</td>
                <td className="text-right tabular-nums">{money(t.total_value)}</td>
                <td className="text-right tabular-nums">{money(t.taxable_value)}</td>
                <td className="text-right tabular-nums">{Number(t.rate_pct)}%</td>
                <td className="text-right font-medium tabular-nums">{money(t.tax_amount)}</td>
                <td className="pl-3 text-right"><TaxLineForm assetId={row.assetId} year={year} line={t} label="แก้ไข" canDelete={canDelete} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div><button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button></div>
    </div>
  ));
}

/** คัดลอกจากปีก่อน ทุกทรัพย์สินที่ปีนี้ยังไม่มีข้อมูล */
function CopyAll({ from, to, ids }: { from: number; to: number; ids: string[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(copyTaxYearAll, {});
  const cf = useConfirmSubmit();
  return (
    <>
      {cf.dialog}
      <form action={action} onSubmit={cf.guard(`คัดลอกข้อมูลภาษีปี ${from + 543} มาเป็นปี ${to + 543} ให้ ${ids.length} ทรัพย์สินที่ปีนี้ยังไม่มีข้อมูล?\n(รายการที่กรอกปีนี้แล้วไม่ถูกทับ · อายุอาคาร +1 ปี)`, { okLabel: "คัดลอก" })}
        className="inline-flex flex-wrap items-center gap-2">
        <input type="hidden" name="from_year" value={from} /><input type="hidden" name="to_year" value={to} />
        <input type="hidden" name="asset_ids" value={ids.join(",")} />
        <button disabled={pending} className="rounded-md border border-blue-600 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50">
          {pending ? "กำลังคัดลอก…" : `คัดลอกจากปี ${from + 543} (ทุกรายการ · ${ids.length})`}</button>
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
        <Flash on={state} as="span" className="text-xs text-emerald-700" />
      </form>
    </>
  );
}
