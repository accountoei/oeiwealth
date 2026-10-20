"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { money, thDate } from "@/lib/format";
import { moveMeta, type MoveMeta } from "@/lib/ledger";
import MoveBadge from "@/components/MoveBadge";
import DateSortHead from "@/components/DateSortHead";
import { useOnMainTab } from "./tabs";

export type MoveRow = {
  key: string; date: string; type: string; fromLabel: string; toLabel: string;
  fromBank: string | null; toBank: string | null;                 // บัญชีธนาคารในระบบ (ใช้กรอง / แยกเข้า–ออก)
  fromAmount: number; fromCcy: string; toAmount: number; toCcy: string; fee?: number;
  thb?: number | null;                                             // ยอดเป็นบาท ณ วันที่ของรายการ (base_amount) · ใช้แสดง ≈ THB ของสกุลอื่น
  extra?: ReactNode; detail: ReactNode; sub?: ReactNode; actions?: ReactNode; typeCls?: string;
  kind: string; merged?: boolean;
  pendingHref?: string;                                            // ป้าย "รอแยกรายละเอียด" → ลิงก์ไปที่แยกรายการ
  metaOpts?: { incomeType: string | null; incomeSubtype: string | null; expenseCategory: string | null; pending: boolean };
};
/** ยอดตาม Statement ของบัญชี (ใช้เป็นจุดตั้งต้นใหม่ของยอดคงเหลือ) */
export type StmtRow = { key: string; date: string; value: number; label: string };

const small = "rounded-md border border-slate-300 bg-white px-2 py-1 text-sm";
/** บรรทัด ≈ THB ใต้ยอดสกุลอื่น */
function Approx({ ccy, thb }: { ccy: string; thb?: number | null }) {
  if (ccy === "THB" || thb == null) return null;
  return <div className="text-xs font-normal text-slate-400">≈ {money(thb, "THB")}</div>;
}

/**
 * ความเคลื่อนไหวของเงิน แบบ Statement: ป้ายประเภท · หมวด · เงินเข้า / ออก · ยอดคงเหลือ (เมื่อดูทีละบัญชี)
 *   ตัวกรอง บัญชี / ประเภท / หมวดหมู่ · เรียงวันที่น้อย → มาก เป็นค่าเริ่มต้น (ล่าสุดอยู่ล่าง)
 *   ทุกบัญชี: โอนระหว่างบัญชีของครอบครัว = ⇄ (ไม่นับเป็นเข้า / ออก)
 *   ทีละบัญชี: แถว "ยอดยกมา" (วันที่ 1) อยู่ต้นรายการเสมอ · ยอดตาม Statement เป็นจุดตั้งต้นใหม่ · ยอดคงเหลือไม่เปลี่ยนตามตัวกรองประเภท / หมวด
 */
export default function MovesView({ rows, banks, showActions = false, openings = {}, statements = {}, monthStart, fixedAcct, limit }: {
  rows: MoveRow[]; banks: { id: string; name: string }[]; showActions?: boolean;
  openings?: Record<string, number | null>; statements?: Record<string, StmtRow[]>; monthStart?: string;
  /** หน้าบัญชี: ล็อกไว้ที่บัญชีนี้ (ไม่มีตัวกรองบัญชี / ปุ่มไปหน้าบัญชี) */
  fixedAcct?: string;
  /** ทุกบัญชี: แสดงเฉพาะ n รายการล่าสุดก่อน (ปุ่ม "แสดงทั้งหมด") · เลือกบัญชีแล้วแสดงทั้งหมดเสมอ (ยอดคงเหลือต่อเนื่อง) */
  limit?: number;
}) {
  const [acctSel, setAcct] = useState("");
  const [type, setType] = useState("");
  const [cat, setCat] = useState("");
  const [asc, setAsc] = useState(true);
  const [all, setAll] = useState(false);
  useOnMainTab(() => { setAcct(""); setType(""); setCat(""); setAll(false); });
  const acct = fixedAcct ?? acctSel;
  const used = banks.filter((b) => rows.some((r) => r.fromBank === b.id || r.toBank === b.id));
  // ทิศทางของเงิน (เทียบกับบัญชีที่เลือก หรือทั้งครอบครัว)
  const dir = (r: MoveRow): "in" | "out" | "move" => {
    if (acct) return r.toBank === acct && r.fromBank !== acct ? "in" : r.fromBank === acct && r.toBank !== acct ? "out" : "move";
    return r.toBank && !r.fromBank ? "in" : r.fromBank && !r.toBank ? "out" : "move";
  };
  const inAcct = rows.filter((r) => !acct || r.fromBank === acct || r.toBank === acct);
  const metaOf = new Map<string, MoveMeta>(inAcct.map((r) => [r.key, moveMeta(r.kind, dir(r), { merged: r.merged, ...(r.metaOpts ?? {}) })]));
  const types = [...new Set(inAcct.map((r) => metaOf.get(r.key)!.label))];
  const cats = [...new Set(inAcct.map((r) => metaOf.get(r.key)!.category))];
  const shown = inAcct.filter((r) => (!type || metaOf.get(r.key)!.label === type) && (!cat || metaOf.get(r.key)!.category === cat));
  const filtered = !!(type || cat);

  // ยอดคงเหลือ (ทีละบัญชี): คิดตามเวลาจากยอดยกมา · ยอดตาม Statement ของวันนั้น = ยอดสิ้นวัน (ตั้งต้นใหม่)
  const opening = acct ? openings[acct] ?? null : null;
  const stmts = acct ? [...(statements[acct] ?? [])].sort((a, b) => a.date.localeCompare(b.date)) : [];
  const withBal = acct !== "" && (opening != null || stmts.length > 0);
  const acctRow = acct ? inAcct[0] : undefined;
  const balCcy = acctRow ? (acctRow.toBank === acct ? acctRow.toCcy : acctRow.fromCcy) : "THB";
  const bm = (v: number | null) => money(v, balCcy === "THB" ? undefined : balCcy);
  type Line = { k: "move"; r: MoveRow; bal: number | null } | { k: "stmt"; s: StmtRow; bal: number; diff: number | null };
  const timeline: Line[] = [];
  if (acct) {
    let run: number | null = opening;
    const queue = [...stmts];
    const flush = (upto: string | null) => {
      while (queue.length && (upto === null || queue[0].date < upto)) {
        const s = queue.shift()!;
        const diff = run == null ? null : Math.round((s.value - run) * 100) / 100;
        run = s.value;
        timeline.push({ k: "stmt", s, bal: run, diff: diff != null && Math.abs(diff) >= 0.005 ? diff : null });
      }
    };
    [...inAcct].reverse().forEach((r) => {                 // rows มาเรียงใหม่ → เก่า
      flush(r.date);
      const d = dir(r);
      if (run != null) run += d === "in" ? r.toAmount : d === "out" ? -(r.fromAmount + (r.fee ?? 0)) : 0;
      timeline.push({ k: "move", r, bal: run });
    });
    flush(null);
  }
  const keep = new Set(shown.map((r) => r.key));
  let lines: Line[] = acct
    ? timeline.filter((l) => (l.k === "move" ? keep.has(l.r.key) : !filtered))
    : [...shown].reverse().map((r) => ({ k: "move" as const, r, bal: null }));
  // จำกัดเฉพาะรายการล่าสุด (lines ตอนนี้เรียง เก่า → ใหม่)
  const total = lines.length;
  const cut = !!limit && !acct && !all && total > limit;
  if (cut) lines = lines.slice(total - limit!);
  if (!asc) lines = [...lines].reverse();

  const totals = new Map<string, { inn: number; out: number }>();
  const thbTot = { inn: 0, out: 0 };
  const add = (ccy: string, k: "inn" | "out", v: number, thb: number | null | undefined) => {
    const t = totals.get(ccy) ?? { inn: 0, out: 0 }; t[k] += v; totals.set(ccy, t);
    thbTot[k] += ccy === "THB" ? v : Number(thb ?? 0);
  };
  shown.forEach((r) => {
    const d = dir(r);
    if (d === "in") add(r.toCcy, "inn", r.toAmount, r.thb);
    if (d === "out") add(r.fromCcy, "out", r.fromAmount, r.thb);
  });
  const foreign = [...totals.keys()].some((c) => c !== "THB");
  const cols = 6 + (withBal ? 1 : 0) + (showActions ? 1 : 0);
  const openRow = withBal && opening != null && !filtered && monthStart ? (
    <tr className="bg-slate-50/70 text-xs text-slate-500">
      <td className="whitespace-nowrap py-1.5 pr-2">{thDate(monthStart)}</td>
      <td className="pr-2"><MoveBadge label="ยอดยกมา" tone="slate" /></td>
      <td colSpan={4} className="pr-2">ยอดคงเหลือสิ้นเดือนก่อน</td>
      <td className={`whitespace-nowrap pl-4 text-right font-medium tabular-nums ${Number(opening ?? 0) < -0.005 ? "text-red-700" : "text-slate-700"}`}>{bm(opening)}</td>
      {showActions && <td></td>}
    </tr>
  ) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
        {!fixedAcct && used.length > 1 && (
          <label className="flex items-center gap-2">บัญชี
            <select value={acctSel} onChange={(e) => setAcct(e.target.value)} className={small}>
              <option value="">ทุกบัญชี</option>
              {used.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
        {types.length > 1 && (
          <label className="flex items-center gap-2">ประเภท
            <select value={type} onChange={(e) => setType(e.target.value)} className={small}>
              <option value="">ทั้งหมด</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        )}
        {cats.length > 1 && (
          <label className="flex items-center gap-2">หมวดหมู่
            <select value={cat} onChange={(e) => setCat(e.target.value)} className={small}>
              <option value="">ทั้งหมด</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
        {!fixedAcct && acctSel && (
          <Link href={`/financial/cash/${acctSel}`} className="rounded-md border border-blue-600 px-2 py-1 text-xs text-blue-700 hover:bg-blue-50">ไปหน้าบัญชี →</Link>
        )}
      </div>
      {cut && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span>แสดง {limit} รายการล่าสุด จากทั้งหมด {total} รายการ (เลือกบัญชีเพื่อดูทั้งหมดพร้อมยอดคงเหลือ)</span>
          <button type="button" onClick={() => setAll(true)} className="rounded-md border border-blue-600 px-2 py-1 text-blue-700 hover:bg-blue-50">แสดงทั้งหมด ({total} รายการ)</button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="py-1.5"><DateSortHead asc={asc} onToggle={() => setAsc(!asc)} /></th><th>ประเภท</th><th>หมวดหมู่</th><th>รายละเอียด</th>
              <th className="pl-4 text-right">เงินเข้า</th><th className="pl-4 text-right">เงินออก</th>
              {withBal && <th className="pl-4 text-right">ยอดคงเหลือ</th>}{showActions && <th></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {asc && openRow}
            {lines.length === 0 && <tr><td colSpan={cols} className="py-4 text-center text-slate-500">{filtered ? "ไม่มีรายการตามตัวกรอง" : "ไม่มีรายการ"}</td></tr>}
            {lines.map((l) => {
              if (l.k === "stmt") return (
                <tr key={l.s.key} className="bg-slate-50/70 text-xs text-slate-500">
                  <td className="whitespace-nowrap py-1.5 pr-2">{thDate(l.s.date)}</td>
                  <td className="pr-2"><MoveBadge label="ยอดตาม Statement" tone="slate" /></td>
                  <td colSpan={4} className="pr-2">{l.s.label}{l.diff != null && <span className="ml-2 text-amber-700">ต่างจากรายการที่บันทึก {l.diff > 0 ? "+" : ""}{bm(l.diff)}</span>}</td>
                  <td className={`whitespace-nowrap pl-4 text-right font-medium tabular-nums ${Number(l.s.value ?? 0) < -0.005 ? "text-red-700" : "text-slate-700"}`}>{bm(l.s.value)}</td>
                  {showActions && <td></td>}
                </tr>
              );
              const r = l.r;
              const d = dir(r);
              const meta = metaOf.get(r.key)!;
              return (
                <tr key={r.key} className="align-top">
                  <td className="whitespace-nowrap py-2 pr-2">{thDate(r.date)}</td>
                  <td className="pr-2"><MoveBadge label={meta.label} tone={meta.tone} /></td>
                  <td className="pr-2">{meta.pending
                    ? (r.pendingHref ? <Link href={r.pendingHref} title="ไปแยกรายการ" className="hover:opacity-80"><MoveBadge label={`${meta.category} →`} tone="amber" /></Link>
                      : <MoveBadge label={meta.category} tone="amber" />)
                    : <span className="text-indigo-700">{meta.category}</span>}</td>
                  <td className="pr-2">
                    <div className="text-slate-800">{r.detail}</div>
                    {r.sub ?? (!fixedAcct && <div className="text-xs text-slate-400">{r.fromLabel} → {r.toLabel}</div>)}
                  </td>
                  {d === "move" ? (
                    <td colSpan={2} className="whitespace-nowrap pl-4 text-right tabular-nums text-slate-500" title="โอนระหว่างบัญชีของครอบครัว (ไม่นับเป็นเงินเข้า / ออก)">
                      ⇄ {money(r.fromAmount, r.fromCcy)}<Approx ccy={r.fromCcy} thb={r.thb} />{r.extra}
                    </td>
                  ) : (
                    <>
                      <td className="whitespace-nowrap pl-4 text-right tabular-nums text-emerald-700">
                        {d === "in" ? <>{money(r.toAmount, r.toCcy)}<Approx ccy={r.toCcy} thb={r.thb} />{r.extra}</> : <span className="text-slate-300">–</span>}
                      </td>
                      <td className="whitespace-nowrap pl-4 text-right tabular-nums text-red-700">
                        {d === "out" ? <>{money(r.fromAmount, r.fromCcy)}<Approx ccy={r.fromCcy} thb={r.thb} />{r.extra}</> : <span className="text-slate-300">–</span>}
                      </td>
                    </>
                  )}
                  {withBal && <td className={`whitespace-nowrap pl-4 text-right tabular-nums ${Number(l.bal ?? 0) < -0.005 ? "text-red-700" : "text-slate-700"}`}>{l.bal == null ? "-" : bm(l.bal)}</td>}
                  {showActions && <td className="pl-2 text-right">{r.actions}</td>}
                </tr>
              );
            })}
            {!asc && openRow}
          </tbody>
          {shown.length > 0 && totals.size > 0 && (
            <tfoot className="border-t border-slate-200 text-sm">
              {[...totals.entries()].map(([ccy, t]) => (
                <tr key={ccy}>
                  <td colSpan={4} className="py-2 font-medium">
                    รวม{filtered ? "ตามตัวกรอง" : ""}{acct ? "" : " (ไม่นับโอนระหว่างบัญชีตัวเอง)"}{totals.size > 1 ? ` · ${ccy}` : ""}
                    <span className={`ml-3 font-semibold ${t.inn - t.out >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                      สุทธิ {t.inn - t.out >= 0 ? "+" : "−"}{money(Math.abs(t.inn - t.out), ccy)}</span>
                  </td>
                  <td className="whitespace-nowrap pl-4 text-right font-medium tabular-nums text-emerald-700">{money(t.inn, ccy)}</td>
                  <td className="whitespace-nowrap pl-4 text-right font-medium tabular-nums text-red-700">{money(t.out, ccy)}</td>
                  <td colSpan={cols - 6}></td>
                </tr>
              ))}
              {foreign && (
                <tr className="text-xs text-slate-500">
                  <td colSpan={4} className="pb-2">≈ รวมเป็นบาท (อัตรา ณ วันที่ของแต่ละรายการ)
                    <span className={`ml-3 font-medium ${thbTot.inn - thbTot.out >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                      สุทธิ {thbTot.inn - thbTot.out >= 0 ? "+" : "−"}{money(Math.abs(thbTot.inn - thbTot.out), "THB")}</span></td>
                  <td className="whitespace-nowrap pb-2 pl-4 text-right tabular-nums">≈ {money(thbTot.inn, "THB")}</td>
                  <td className="whitespace-nowrap pb-2 pl-4 text-right tabular-nums">≈ {money(thbTot.out, "THB")}</td>
                  <td colSpan={cols - 6}></td>
                </tr>
              )}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
