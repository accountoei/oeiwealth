"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { money, numOrZero } from "@/lib/format";
import { COMP_TYPE_LABEL, type CompInput, type CompType, type Component } from "./components";
import { splitByArea } from "./valueParts";

const cell = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";
const num = `${cell} text-right tabular-nums`;
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plain = (s: string) => s.replace(/,/g, "").trim();
const filled = (s: string) => plain(s) !== "";
const round2 = (n: number) => Math.round(n * 100) / 100;

type Row = CompInput & { key: string; rai: string; ngan: string; wa: string; value: string;
  /** ฟอร์มเพิ่มใหม่: แก้มูลค่าแถวนี้เองแล้ว (มูลค่าไม่ตามต้นทุนอีก) */ vTouched?: boolean };

function toRow(c: Component, value: number | undefined, defaultDate: string): Row {
  const w = c.land_area_sq_wa != null ? Number(c.land_area_sq_wa) : null;
  const s = (v: string | number | null) => (v == null ? "" : String(v));
  return {
    key: c.id, id: c.id, type: c.component_type, label: s(c.label), title_type: s(c.title_type), title_deed_no: s(c.title_deed_no),
    land_no: s(c.land_no), deed_book: s(c.deed_book), deed_page: s(c.deed_page), map_sheet: s(c.map_sheet), survey_page: s(c.survey_page),
    land_area_sq_wa: s(w), rai: w != null ? String(Math.floor(w / 400)) : "", ngan: w != null ? String(Math.floor((w % 400) / 100)) : "",
    wa: w != null ? String(+(w % 100).toFixed(2)) : "", building_area_sqm: s(c.building_area_sqm), useful_life_years: s(c.useful_life_years),
    acquired_date: c.acquired_date ?? defaultDate, acq_cost: c.acq_cost != null ? fmt(Number(c.acq_cost)) : "", notes: s(c.notes),
    value: value != null ? fmt(value) : "",
  };
}
const blank = (type: CompType): Row => ({
  key: `n${Math.random().toString(36).slice(2)}`, type, label: "", title_type: type === "LAND" ? "โฉนด" : "", title_deed_no: "", land_no: "",
  deed_book: "", deed_page: "", map_sheet: "", survey_page: "", land_area_sq_wa: "", rai: "", ngan: "", wa: "", building_area_sqm: "",
  useful_life_years: type === "LAND" ? "" : "20", acquired_date: "", acq_cost: "", notes: "", value: "",
});
const sqwa = (r: Row) => (filled(r.rai) || filled(r.ngan) || filled(r.wa)
  ? numOrZero(r.rai) * 400 + numOrZero(r.ngan) * 100 + numOrZero(r.wa) : null);
/** แถวว่าง (ยังไม่ได้กรอกอะไร) ไม่ส่งไปบันทึก */
const isEmpty = (r: Row) => !r.id && ![r.label, r.title_deed_no, r.land_no, r.rai, r.ngan, r.wa, r.building_area_sqm, r.acq_cost, r.value, r.notes,
  r.deed_book, r.deed_page, r.map_sheet, r.survey_page].some(filled);

/**
 * ตารางส่วนประกอบของทรัพย์สิน (ตกลง 29 ต.ค. 2026) — ใช้ทั้งฟอร์มเพิ่มใหม่และฟอร์มแก้ไข
 *   แต่ละแถว = ที่ดิน 1 โฉนด / สิ่งปลูกสร้าง 1 รายการ · ข้อมูลตัวทรัพย์ + วันที่ได้มา + ต้นทุนที่ได้มา + มูลค่า
 *   ราคาที่ได้มา / มูลค่าของทรัพย์สิน = ผลรวมรายแถว (หรือใส่ยอดรวมที่แถวรวม) · ใส่ยอดรวมแล้วเฉลี่ยให้ที่ดินตามเนื้อที่ได้ (หักสิ่งปลูกสร้างที่ใส่เองก่อน)
 *   ต้นทุนต้องใส่ (รายแถว หรือยอดรวม) · ฟอร์มเพิ่มใหม่: มูลค่าขึ้นตามต้นทุนเอง แก้ทับได้ (ตกลง 29 ต.ค. 2026)
 *   ฟอร์มแก้ไข: มูลค่าแสดงอย่างเดียว (ปรับที่ปุ่ม "มูลค่าและต้นทุน") · เพิ่มแถวแยกโฉนด / ลบแถวที่มีมูลค่า → ระบบแบ่งมูลค่ารายแถวใหม่ ยอดรวมเท่าเดิม
 *   ส่งออกเป็นช่องซ่อน: components (JSON) · removed (JSON) · acquisition_cost · value · value_changed
 */
export default function ComponentTable({ mode, currency, initial = [], latest = {}, acquisitionCost = null, currentValue = null, today,
  defaultDate = "", locked = [], onEarliest }: {
  mode: "new" | "edit"; currency: string; initial?: Component[];
  /** มูลค่าล่าสุดรายแถว (id → ยอด) */ latest?: Record<string, number>;
  acquisitionCost?: number | null; currentValue?: number | null;
  /** ฟอร์มแก้ไข: วันที่ของมูลค่าที่แบ่งรายแถวใหม่ */ today?: string; minDate?: string;
  /** ฟอร์มแก้ไข: แถวเดิมที่ยังไม่มีวันที่ได้มา → ใช้วันที่ได้มาของทรัพย์สิน */ defaultDate?: string;
  /** ฟอร์มแก้ไข: แถวที่ผูกกับรายการเงิน (สร้างจาก / มีรายการจ่าย) → ลบไม่ได้ · แก้ต้นทุนในแถวไม่ได้ */ locked?: string[];
  /** วันที่ได้มาเก่าสุดของทุกแถว (ฟอร์มเพิ่มใหม่ใช้ตัดสินว่าเป็นยอดตั้งต้นก่อน Go-live หรือไม่) */ onEarliest?: (date: string) => void;
}) {
  const isNew = mode === "new";
  const init = useMemo(() => initial.map((c) => toRow(c, latest[c.id], defaultDate)), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const [rows, setRows] = useState<Row[]>(() => (init.length || !isNew ? init : [blank("LAND")]));
  const [removed, setRemoved] = useState<string[]>([]);
  const [costTotal, setCostTotal] = useState(!isNew && acquisitionCost != null ? fmt(Number(acquisitionCost)) : "");
  const [valueTotal, setValueTotal] = useState("");
  const [totalTouched, setTotalTouched] = useState(false);
  const [spreadTotal, setSpreadTotal] = useState("");
  const [addOpen, setAddOpen] = useState(isNew);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // ฟอร์มเพิ่มใหม่: แก้ต้นทุน → มูลค่าตาม (ถ้ายังไม่ได้แก้มูลค่าแถวนั้นเอง)
  const setCost = (key: string, v: string) => setRows((rs) => rs.map((r) => (r.key !== key ? r
    : { ...r, acq_cost: v, ...(isNew && !r.vTouched ? { value: v } : {}) })));
  const setValue = (key: string, v: string) => set(key, { value: v, vTouched: true });

  const live = rows.filter((r) => !isEmpty(r));
  const costRows = live.filter((r) => filled(r.acq_cost));
  const costSum = round2(costRows.reduce((t, r) => t + numOrZero(r.acq_cost), 0));
  // ต้นทุน: ครบทุกแถว = ผลรวม · ใส่บางแถว = ยอดรวมที่แถวรวม (ส่วนที่เหลือ = "ยังไม่แยก") หรือผลรวมถ้าไม่ใส่ยอดรวม
  const allCost = live.length > 0 && costRows.length === live.length;
  const cost = allCost ? String(costSum) : filled(costTotal) ? plain(costTotal) : costRows.length ? String(costSum) : "";
  const costShort = !allCost && costRows.length > 0 && filled(costTotal) && numOrZero(costTotal) < costSum - 0.005;
  // วันที่ได้มาของทรัพย์สิน = วันที่เก่าสุดของแถว (ตกลง 29 ต.ค. 2026 · ไม่มีช่องแยก)
  const earliest = rows.map((r) => r.acquired_date).filter(Boolean).sort()[0] ?? "";
  useEffect(() => { onEarliest?.(earliest); }, [earliest, onEarliest]);
  const lockedSet = new Set(locked);
  const areaSum = live.filter((r) => r.type === "LAND").reduce((t, r) => t + (sqwa(r) ?? 0), 0);

  // ---- มูลค่า ----
  // ฟอร์มเพิ่มใหม่: ไม่ได้แก้มูลค่าเลย = ใช้ยอดเดียวกับต้นทุน (ราคาทุน) · แก้เองแล้ว = ต้องครบทุกแถว หรือใส่ยอดรวม
  const touched = isNew && (totalTouched || rows.some((r) => r.vTouched));
  const valueRows = live.filter((r) => filled(r.value));
  const allValue = live.length > 0 && valueRows.length === live.length;
  const valueSum = round2(valueRows.reduce((t, r) => t + numOrZero(r.value), 0));
  const newValue = !touched ? cost : allValue ? String(valueSum) : plain(valueTotal);
  const partial = touched && valueRows.length > 0 && !allValue;
  // ฟอร์มแก้ไข: แยกโฉนด (เพิ่มแถว) / ลบแถวที่มีมูลค่า → แบ่งมูลค่ารายแถวใหม่ ยอดรวมเท่าเดิม (Net Worth ไม่เปลี่ยน)
  const hasParts = Object.keys(latest).length > 0;
  const freed = round2(removed.reduce((t, id) => t + (latest[id] ?? 0), 0));
  const added = live.filter((r) => !r.id);
  const resplit = !isNew && hasParts && (freed > 0 || added.length > 0);
  const editValues: Record<string, number> = {};
  if (!isNew) {
    for (const r of live) editValues[r.key] = r.id ? latest[r.id] ?? 0 : 0;
    if (resplit) {
      const lands = live.filter((r) => r.type === "LAND");
      const newLand = lands.some((r) => !r.id);
      const pool = freed + (newLand ? lands.reduce((t, r) => t + editValues[r.key], 0) : 0);
      if (lands.length) {
        const share = splitByArea(round2(pool), lands.map((r) => sqwa(r) ?? 0));
        lands.forEach((r, i) => { editValues[r.key] = round2((newLand ? 0 : editValues[r.key]) + share[i]); });
      } else if (live.length) editValues[live[0].key] = round2(editValues[live[0].key] + freed);
    }
  }
  const editTotal = round2(Object.values(editValues).reduce((t, v) => t + v, 0));

  const payload = live.map((r) => {
    const out: CompInput = {
      ...(r.id ? { id: r.id } : {}), type: r.type, label: r.label, title_type: r.title_type, title_deed_no: r.title_deed_no, land_no: r.land_no,
      deed_book: r.deed_book, deed_page: r.deed_page, map_sheet: r.map_sheet, survey_page: r.survey_page,
      land_area_sq_wa: r.type === "LAND" ? String(sqwa(r) ?? "") : "", building_area_sqm: plain(r.building_area_sqm),
      useful_life_years: plain(r.useful_life_years), acquired_date: r.acquired_date, acq_cost: plain(r.acq_cost), notes: r.notes,
    };
    if (isNew ? allValue : resplit) out.value = isNew ? plain(r.value) : String(editValues[r.key]);
    return out;
  });

  // ซื้อรวมหลายโฉนด: ยอดรวม − สิ่งปลูกสร้างที่ใส่เอง → เฉลี่ยให้ที่ดินตามเนื้อที่ (แถวที่ผูกรายการจ่ายไม่ถูกเปลี่ยน)
  const spread = () => {
    const lands = rows.filter((r) => r.type === "LAND" && !(r.id && lockedSet.has(r.id)));
    if (!lands.length) return;
    const others = round2(rows.filter((r) => !lands.includes(r)).reduce((t, r) => t + numOrZero(r.acq_cost), 0));
    const out = splitByArea(numOrZero(spreadTotal) - others, lands.map((r) => sqwa(r) ?? 0));
    setRows((rs) => rs.map((r) => {
      const i = lands.findIndex((x) => x.key === r.key);
      return i < 0 ? r : { ...r, acq_cost: fmt(out[i]), ...(isNew && !r.vTouched ? { value: fmt(out[i]) } : {}) };
    }));
  };
  const remove = (r: Row) => {
    setRows((rs) => rs.filter((x) => x.key !== r.key));
    if (r.id) setRemoved((ids) => [...ids, r.id!]);
    setConfirmKey(null);
  };
  // ลบได้เมื่อยังเหลืออย่างน้อย 1 แถว และแถวนั้นไม่ผูกกับรายการเงิน
  const canRemove = (r: Row) => !(r.id && lockedSet.has(r.id)) && (isEmpty(r) || live.length > 1);
  // ช่องเงิน: คอมมาตอนพิมพ์ / .00 ตอนออกจากช่อง ใช้ตัวจัดรูปกลาง (NumberInputs)
  const money2 = (r: Row, col: "acq_cost" | "value", readOnly = false) => (
    <input value={r[col]} onChange={(e) => (col === "acq_cost" ? setCost(r.key, e.target.value) : setValue(r.key, e.target.value))}
      inputMode="decimal" aria-label={col === "acq_cost" ? "ต้นทุนที่ได้มา" : "มูลค่า"} readOnly={readOnly}
      required={col === "acq_cost" && !readOnly && !r.id && !isEmpty(r) && (!isNew || !filled(costTotal))}
      title={readOnly ? "แถวนี้ผูกกับรายการจ่าย — แก้ยอดที่รายการจ่าย" : undefined} className={`${num} ${readOnly ? "bg-slate-50 text-slate-500" : ""}`} />
  );
  const valueCell = (r: Row) => (isNew ? money2(r, "value") : (
    <div className={`px-2 py-1.5 text-right tabular-nums ${resplit && Math.abs(editValues[r.key] - (r.id ? latest[r.id] ?? 0 : 0)) > 0.005 ? "text-blue-700" : "text-slate-600"}`}>
      {hasParts || resplit ? money(editValues[r.key] ?? 0, undefined, 2) : "-"}</div>
  ));

  return (
    <div className="space-y-2">
      <input type="hidden" name="components" value={JSON.stringify(payload)} />
      <input type="hidden" name="removed" value={JSON.stringify(removed)} />
      <input type="hidden" name="acquisition_cost" value={cost} />
      <input type="hidden" name="acquisition_date" value={earliest || defaultDate} />
      {isNew && <>
        <input type="hidden" name="value" value={newValue} />
        <input type="hidden" name="valuation_method" value={touched ? "USER_ESTIMATE" : "BOOK_VALUE"} />
      </>}
      {resplit && <>
        <input type="hidden" name="value_changed" value="1" /><input type="hidden" name="value" value={String(editTotal)} />
        <input type="hidden" name="valuation_date" value={today ?? ""} /><input type="hidden" name="valuation_method" value="USER_ESTIMATE" />
        <input type="hidden" name="valuation_notes" value="แบ่งมูลค่ารายแถวใหม่ (แยก / ลบแถว · ยอดรวมเท่าเดิม)" />
      </>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] table-fixed text-sm">
          <colgroup>
            <col className="w-28" /><col /><col className="w-48" /><col className="w-40" /><col className="w-40" /><col className="w-40" /><col className="w-24" />
          </colgroup>
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-1">ชนิด</th><th>ส่วนประกอบ</th><th>เนื้อที่ / พื้นที่</th><th>วันที่ได้มา</th>
              <th className="pr-2 text-right">ต้นทุนที่ได้มา <span className="text-red-600">*</span></th>
              <th className="pr-2 text-right">มูลค่า ({currency}){!isNew && <span className="font-normal"> · ล่าสุด</span>}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <RowView key={r.key} r={r} set={set} cost={money2(r, "acq_cost", !!r.id && lockedSet.has(r.id))} value={valueCell(r)}
                del={canRemove(r) ? (confirmKey === r.key
                  ? <span className="flex flex-col items-end gap-1"><span className="text-slate-600">ลบแถวนี้?</span>
                      <span><button type="button" onClick={() => remove(r)} className="text-red-600 hover:underline">ยืนยันลบ</button>
                        <button type="button" onClick={() => setConfirmKey(null)} className="ml-2 text-slate-500 hover:underline">ไม่</button></span></span>
                  : <button type="button" onClick={() => (isEmpty(r) ? remove(r) : setConfirmKey(r.key))} className="text-red-600 hover:underline">ลบ</button>)
                  : <span className="text-slate-400" title={r.id && lockedSet.has(r.id) ? "ผูกกับรายการจ่าย — ลบ / ย้ายรายการจ่ายก่อน" : "ต้องเหลืออย่างน้อย 1 แถว"}>
                      {r.id && lockedSet.has(r.id) ? "ผูกรายการจ่าย" : "แถวสุดท้าย"}</span>} />
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="py-3 text-sm text-slate-500">ยังไม่มีส่วนประกอบ · เพิ่มที่ดิน / สิ่งปลูกสร้างด้านล่าง (หรือใส่ยอดรวมที่แถวรวมอย่างเดียว)</td></tr>}
          </tbody>
          <tfoot className="border-t-2 border-slate-200">
            <tr className="align-top">
              <td className="py-2 font-medium" colSpan={2}>รวมทั้งทรัพย์สิน <span className="font-normal text-xs text-slate-500">(มูลค่ารวมนับใน Net Worth)</span></td>
              <td className="py-2 pr-2 text-xs tabular-nums text-slate-600">{areaSum > 0 ? `${areaSum.toLocaleString("en-US", { maximumFractionDigits: 2 })} ตร.ว.` : ""}</td>
              <td></td>
              <td className="py-1 pr-2 text-right">{allCost
                ? <div className="px-2 py-1.5 font-semibold tabular-nums">{money(costSum, undefined, 2)}</div>
                : <input value={costTotal} onChange={(e) => { setCostTotal(e.target.value); if (!totalTouched) setValueTotal(e.target.value); }}
                    inputMode="decimal" aria-label="ราคาที่ได้มารวม" required={isNew && !costRows.length}
                    placeholder={costRows.length ? fmt(costSum) : "ยอดรวม"} className={num} />}
                {!allCost && costRows.length > 0 && filled(costTotal) && !costShort && numOrZero(costTotal) - costSum > 0.005 &&
                  <span className="mt-1 block text-xs font-normal text-slate-500">ยังไม่แยก {money(numOrZero(costTotal) - costSum, undefined, 2)}</span>}</td>
              <td className="py-1 pr-2 text-right">{!isNew
                ? <div className="px-2 py-1.5 font-semibold tabular-nums">{money(currentValue ?? 0, undefined, 2)}</div>
                : allValue
                ? <div className="px-2 py-1.5 font-semibold tabular-nums">{money(valueSum, undefined, 2)}</div>
                : <input value={totalTouched ? valueTotal : costTotal} onChange={(e) => { setValueTotal(e.target.value); setTotalTouched(true); }}
                    inputMode="decimal" aria-label="มูลค่ารวม" required={touched && !valueRows.length} placeholder="ยอดรวม" className={num} />}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      {/* ฟอร์มแก้ไข: เพิ่มแถวได้เฉพาะ "กรอกตกหล่น / แยกโฉนด" (ไม่มีเงินเข้าออก) · ซื้อเพิ่ม / สร้างใหม่ ใช้ปุ่ม "จ่ายซื้อ / จ่ายเพิ่ม" */}
      {!addOpen ? (
        <button type="button" onClick={() => setAddOpen(true)} className="text-xs text-slate-500 underline hover:text-slate-700">
          + เพิ่มแถวที่กรอกตกหล่น / แยกโฉนด (ไม่มีเงินเข้าออก)</button>
      ) : (
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <button type="button" onClick={() => setRows((rs) => [...rs, blank("LAND")])} className="text-blue-700 hover:underline">+ ที่ดิน (โฉนด)</button>
          <button type="button" onClick={() => setRows((rs) => [...rs, blank("BUILDING")])} className="text-blue-700 hover:underline">+ สิ่งปลูกสร้าง</button>
          {!isNew && <span className="text-xs text-slate-500">ใช้แก้ข้อมูลที่กรอกตกหล่น / แยกโฉนดที่รวมอยู่ในแถวเดียว · ซื้อที่ดินเพิ่ม / สร้างใหม่ ให้ใช้ปุ่ม &ldquo;จ่ายซื้อ / จ่ายเพิ่ม&rdquo; (บันทึกเงินออกจากบัญชีด้วย)</span>}
        </div>
        {rows.filter((r) => r.type === "LAND").length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500">ซื้อรวมหลายโฉนด: ยอดรวม</span>
            <input value={spreadTotal} onChange={(e) => setSpreadTotal(e.target.value)} inputMode="decimal" aria-label="ยอดรวมสำหรับเฉลี่ย"
              className="w-40 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm tabular-nums" />
            <button type="button" onClick={spread} disabled={!numOrZero(spreadTotal)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50">เฉลี่ยเป็นต้นทุนที่ดินตามเนื้อที่</button>
            <span className="text-xs text-slate-500">หักสิ่งปลูกสร้างที่ใส่เองก่อน ที่เหลือแบ่งให้ที่ดินตามเนื้อที่ · แก้รายแถวได้</span>
          </div>
        )}
      </div>
      )}
      <p className="text-xs text-slate-500">
        สิ่งปลูกสร้างแต่ละรายการมีต้นทุน มูลค่า และอายุใช้งานของตัวเอง (ใช้หักค่าเสื่อมในราคาขายขั้นต่ำที่คุ้ม) · ไม่ใส่ต้นทุนรายแถว = ใส่ยอดรวมที่แถวรวม
        {isNew ? " · มูลค่าขึ้นตามต้นทุนเอง แก้ได้ถ้ามูลค่าวันนี้ไม่เท่าต้นทุน" : " · ปรับมูลค่าที่ปุ่ม “มูลค่าและต้นทุน”"}
      </p>
      {costShort && <p className="text-sm text-amber-700">ต้นทุนรวมน้อยกว่าผลรวมต้นทุนรายแถว ({money(costSum, undefined, 2)})</p>}
      {partial && <p className="text-sm text-amber-700">ใส่มูลค่าให้ครบทุกแถว หรือลบมูลค่ารายแถวออกให้หมดแล้วใส่ยอดรวม</p>}
      {resplit && (
        <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800">แยก / ลบแถว → ระบบแบ่งมูลค่ารายแถวใหม่ (ตัวเลขสีน้ำเงิน · ที่ดินเฉลี่ยตามเนื้อที่) ·
          ยอดรวมเท่าเดิม <span className="tabular-nums">{money(editTotal, undefined, 2)}</span> · Net Worth ไม่เปลี่ยน · ถ้ามูลค่าจริงต่างจากนี้ ปรับที่ปุ่ม &ldquo;มูลค่าและต้นทุน&rdquo; หลังบันทึก</p>
      )}
    </div>
  );
}

function RowView({ r, set, cost, value, del }: {
  r: Row; set: (key: string, patch: Partial<Row>) => void; cost: ReactNode; value: ReactNode; del: ReactNode;
}) {
  const t = (k: keyof Row, placeholder: string, extra = "") => (
    <input value={String(r[k] ?? "")} onChange={(e) => set(r.key, { [k]: e.target.value })} placeholder={placeholder} aria-label={placeholder}
      data-plain className={`${cell} ${extra}`} />
  );
  const land = r.type === "LAND";
  // 2 บรรทัดต่อแถว · บรรทัดที่ 2 ตรงคอลัมน์บรรทัดแรก: เล่ม หน้า ระวาง ใต้ส่วนประกอบ · หน้าสำรวจ / อายุใช้งาน ใต้เนื้อที่ · หมายเหตุ ใต้วันที่ → มูลค่า
  return (
    <>
      <tr className="align-top">
        <td className="pt-2 pr-2"><span className="inline-block pt-1.5 text-sm">{COMP_TYPE_LABEL[r.type]}</span></td>
        <td className="pt-2 pr-2">
          {land ? (
            <div className="grid grid-cols-3 gap-1">{t("title_type", "ประเภท")}{t("title_deed_no", "เลขที่โฉนด")}{t("land_no", "เลขที่ดิน")}</div>
          ) : t("label", "เช่น บ้านเดี่ยว 2 ชั้น · รั้ว · สระว่ายน้ำ")}
        </td>
        <td className="pt-2 pr-2">
          {land ? (
            <div className="grid grid-cols-3 gap-1">
              <input value={r.rai} onChange={(e) => set(r.key, { rai: e.target.value })} inputMode="numeric" data-plain placeholder="ไร่" aria-label="ไร่" className={cell} />
              <input value={r.ngan} onChange={(e) => set(r.key, { ngan: e.target.value })} inputMode="numeric" data-plain placeholder="งาน" aria-label="งาน" className={cell} />
              <input value={r.wa} onChange={(e) => set(r.key, { wa: e.target.value })} inputMode="decimal" data-money="off" placeholder="ตร.ว." aria-label="ตารางวา" className={cell} />
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <input value={r.building_area_sqm} onChange={(e) => set(r.key, { building_area_sqm: e.target.value })} inputMode="decimal" data-money="off"
                placeholder="พื้นที่ใช้สอย" aria-label="พื้นที่ใช้สอย (ตร.ม.)" className={cell} /><span className="text-xs text-slate-500">ตร.ม.</span>
            </div>
          )}
        </td>
        <td className="pt-2 pr-2"><input type="date" value={r.acquired_date} onChange={(e) => set(r.key, { acquired_date: e.target.value })}
          required={!isEmpty(r)} aria-label="วันที่ได้มา" className={cell} /></td>
        <td className="pt-2 pr-2">{cost}</td>
        <td className="pt-2 pr-2">{value}</td>
        <td className="whitespace-nowrap pt-3 text-right text-xs">{del}</td>
      </tr>
      <tr className="border-b border-slate-100 align-top">
        <td></td>
        <td className="pb-2 pr-2 pt-1">
          {land && <div className="grid grid-cols-3 gap-1">{t("deed_book", "เล่ม")}{t("deed_page", "หน้า")}{t("map_sheet", "ระวาง")}</div>}
        </td>
        <td className="pb-2 pr-2 pt-1">
          {land ? t("survey_page", "หน้าสำรวจ") : (
            <label className="flex items-center gap-1 whitespace-nowrap text-xs text-slate-600">อายุใช้งาน
              <input value={r.useful_life_years} onChange={(e) => set(r.key, { useful_life_years: e.target.value })} inputMode="numeric" data-plain
                aria-label="อายุใช้งาน (ปี)" className={`${cell} !w-14 text-right`} />ปี</label>
          )}
        </td>
        <td colSpan={3} className="pb-2 pr-2 pt-1">{t("notes", "หมายเหตุ")}</td>
        <td></td>
      </tr>
    </>
  );
}
