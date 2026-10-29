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

type Row = CompInput & { key: string; rai: string; ngan: string; wa: string; open: boolean; value: string };

function toRow(c: Component, value: number | undefined): Row {
  const w = c.land_area_sq_wa != null ? Number(c.land_area_sq_wa) : null;
  const s = (v: string | number | null) => (v == null ? "" : String(v));
  return {
    key: c.id, id: c.id, type: c.component_type, label: s(c.label), title_type: s(c.title_type), title_deed_no: s(c.title_deed_no),
    land_no: s(c.land_no), deed_book: s(c.deed_book), deed_page: s(c.deed_page), map_sheet: s(c.map_sheet), survey_page: s(c.survey_page),
    land_area_sq_wa: s(w), rai: w != null ? String(Math.floor(w / 400)) : "", ngan: w != null ? String(Math.floor((w % 400) / 100)) : "",
    wa: w != null ? String(+(w % 100).toFixed(2)) : "", building_area_sqm: s(c.building_area_sqm), useful_life_years: s(c.useful_life_years),
    acquired_date: s(c.acquired_date), acq_cost: c.acq_cost != null ? fmt(Number(c.acq_cost)) : "", notes: s(c.notes),
    value: value != null ? fmt(value) : "", open: false,
  };
}
const blank = (type: CompType): Row => ({
  key: `n${Math.random().toString(36).slice(2)}`, type, label: "", title_type: type === "LAND" ? "โฉนด" : "", title_deed_no: "", land_no: "",
  deed_book: "", deed_page: "", map_sheet: "", survey_page: "", land_area_sq_wa: "", rai: "", ngan: "", wa: "", building_area_sqm: "",
  useful_life_years: type === "LAND" ? "" : "20", acquired_date: "", acq_cost: "", notes: "", value: "", open: false,
});
const sqwa = (r: Row) => (filled(r.rai) || filled(r.ngan) || filled(r.wa)
  ? numOrZero(r.rai) * 400 + numOrZero(r.ngan) * 100 + numOrZero(r.wa) : null);
/** แถวว่าง (ยังไม่ได้กรอกอะไร) ไม่ส่งไปบันทึก */
const isEmpty = (r: Row) => !r.id && ![r.label, r.title_deed_no, r.land_no, r.rai, r.ngan, r.wa, r.building_area_sqm, r.acq_cost, r.value, r.notes,
  r.deed_book, r.deed_page, r.map_sheet, r.survey_page].some(filled);

/**
 * ตารางส่วนประกอบของทรัพย์สิน (ตกลง 29 ต.ค. 2026) — ใช้ทั้งฟอร์มเพิ่มใหม่และฟอร์มแก้ไข
 *   แต่ละแถว = ที่ดิน 1 โฉนด / อาคาร 1 หลัง / สิ่งปลูกสร้างอื่น · ข้อมูลตัวทรัพย์ + วันที่ได้มา + ต้นทุนที่ได้มา + มูลค่า
 *   ราคาที่ได้มา / มูลค่าของทรัพย์สิน = ผลรวมรายแถว (หรือใส่ยอดรวมที่แถวรวม) · ใส่ยอดรวมแล้วเฉลี่ยให้ที่ดินตามเนื้อที่ได้ (หักอาคารที่ใส่เองก่อน)
 *   ส่งออกเป็นช่องซ่อน: components (JSON) · removed (JSON) · acquisition_cost · value · value_changed
 */
export default function ComponentTable({ mode, currency, initial = [], latest = {}, acquisitionCost = null, currentValue = null, today, minDate,
  onValueFromCost }: {
  mode: "new" | "edit"; currency: string; initial?: Component[];
  /** มูลค่าล่าสุดรายแถว (id → ยอด) */ latest?: Record<string, number>;
  acquisitionCost?: number | null; currentValue?: number | null;
  /** ฟอร์มแก้ไข: ช่วงวันที่ของมูลค่าใหม่ */ today?: string; minDate?: string;
  /** ฟอร์มเพิ่มใหม่: มูลค่าใช้ยอดเดียวกับต้นทุน (เปลี่ยนวิธีประเมินเป็น "ราคาทุน") */ onValueFromCost?: (on: boolean) => void;
}) {
  const init = useMemo(() => initial.map((c) => toRow(c, latest[c.id])), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const [rows, setRows] = useState<Row[]>(() => (init.length || mode === "edit" ? init : [blank("LAND")]));
  const [removed, setRemoved] = useState<string[]>([]);
  const [costTotal, setCostTotal] = useState(mode === "edit" && acquisitionCost != null ? fmt(Number(acquisitionCost)) : "");
  const [valueTotal, setValueTotal] = useState("");
  const [spreadTotal, setSpreadTotal] = useState("");
  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const live = rows.filter((r) => !isEmpty(r));
  const costRows = live.filter((r) => filled(r.acq_cost));
  const valueRows = live.filter((r) => filled(r.value));
  const costSum = round2(costRows.reduce((t, r) => t + numOrZero(r.acq_cost), 0));
  const valueSum = round2(valueRows.reduce((t, r) => t + numOrZero(r.value), 0));
  // ต้นทุน: ครบทุกแถว = ผลรวม · ใส่บางแถว = ยอดรวมที่แถวรวม (ส่วนที่เหลือ = "ยังไม่แยก") หรือผลรวมถ้าไม่ใส่ยอดรวม
  const allCost = live.length > 0 && costRows.length === live.length;
  const cost = allCost ? String(costSum) : filled(costTotal) ? plain(costTotal) : costRows.length ? String(costSum) : "";
  const costShort = !allCost && costRows.length > 0 && filled(costTotal) && numOrZero(costTotal) < costSum - 0.005;
  const valueTyped = valueRows.length ? String(valueSum) : plain(valueTotal);
  // ฟอร์มเพิ่มใหม่: ไม่ได้ใส่มูลค่าเลย → ใช้ยอดเดียวกับต้นทุน
  const fromCost = mode === "new" && !valueTyped && !!cost;
  const value = fromCost ? cost : valueTyped;
  useEffect(() => { onValueFromCost?.(fromCost); }, [fromCost, onValueFromCost]);
  const areaSum = live.filter((r) => r.type === "LAND").reduce((t, r) => t + (sqwa(r) ?? 0), 0);
  // ฟอร์มแก้ไข: มูลค่าเปลี่ยน (แก้รายแถว / ลบแถวที่มีมูลค่า / ใส่ยอดรวมใหม่) → บันทึกมูลค่าใหม่
  const valueChanged = mode === "edit" && (
    rows.some((r) => plain(r.value) !== plain(init.find((x) => x.key === r.key)?.value ?? ""))
    || removed.some((id) => latest[id] != null) || (!valueRows.length && filled(valueTotal)));
  const partial = valueRows.length > 0 && valueRows.length < live.length;

  const payload = live.map((r) => {
    const out: CompInput = {
      ...(r.id ? { id: r.id } : {}), type: r.type, label: r.label, title_type: r.title_type, title_deed_no: r.title_deed_no, land_no: r.land_no,
      deed_book: r.deed_book, deed_page: r.deed_page, map_sheet: r.map_sheet, survey_page: r.survey_page,
      land_area_sq_wa: r.type === "LAND" ? String(sqwa(r) ?? "") : "", building_area_sqm: plain(r.building_area_sqm),
      useful_life_years: plain(r.useful_life_years), acquired_date: r.acquired_date, acq_cost: plain(r.acq_cost), notes: r.notes,
    };
    if (valueRows.length) out.value = plain(r.value);
    return out;
  });

  const spread = (col: "acq_cost" | "value") => {
    const lands = rows.filter((r) => r.type === "LAND");
    if (!lands.length) return;
    const others = round2(rows.filter((r) => r.type !== "LAND").reduce((t, r) => t + numOrZero(r[col]), 0));
    const out = splitByArea(numOrZero(spreadTotal) - others, lands.map((r) => sqwa(r) ?? 0));
    setRows((rs) => rs.map((r) => { const i = lands.findIndex((x) => x.key === r.key); return i >= 0 ? { ...r, [col]: fmt(out[i]) } : r; }));
  };
  const remove = (r: Row) => {
    setRows((rs) => rs.filter((x) => x.key !== r.key));
    if (r.id) setRemoved((ids) => [...ids, r.id!]);
  };
  const money2 = (key: string, col: "acq_cost" | "value", v: string) => (
    <input value={v} onChange={(e) => set(key, { [col]: e.target.value })} onBlur={(e) => filled(e.target.value) && set(key, { [col]: fmt(numOrZero(e.target.value)) })}
      inputMode="decimal" data-plain aria-label={col === "acq_cost" ? "ต้นทุนที่ได้มา" : "มูลค่า"} className={num} />
  );

  return (
    <div className="space-y-2">
      <input type="hidden" name="components" value={JSON.stringify(payload)} />
      <input type="hidden" name="removed" value={JSON.stringify(removed)} />
      <input type="hidden" name="acquisition_cost" value={cost} />
      <input type="hidden" name="value" value={value} />
      {valueChanged && <input type="hidden" name="value_changed" value="1" />}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="w-28 py-1">ชนิด</th><th>ส่วนประกอบ</th><th className="w-44">เนื้อที่ / พื้นที่</th><th className="w-36">วันที่ได้มา</th>
              <th className="w-36 text-right">ต้นทุนที่ได้มา</th><th className="w-36 text-right">มูลค่า ({currency})</th><th className="w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <RowView key={r.key} r={r} set={set} remove={remove} money2={money2} />
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="py-3 text-sm text-slate-500">ยังไม่มีส่วนประกอบ · เพิ่มที่ดิน / อาคารด้านล่าง (หรือใส่ยอดรวมที่แถวรวมอย่างเดียว)</td></tr>}
          </tbody>
          <tfoot className="border-t-2 border-slate-200">
            <tr className="align-top">
              <td className="py-2 font-medium" colSpan={2}>รวมทั้งทรัพย์สิน <span className="font-normal text-xs text-slate-500">(มูลค่ารวมนับใน Net Worth)</span></td>
              <td className="py-2 text-xs tabular-nums text-slate-600">{areaSum > 0 ? `${areaSum.toLocaleString("en-US", { maximumFractionDigits: 2 })} ตร.ว.` : ""}</td>
              <td></td>
              <td className="py-1 text-right">{allCost
                ? <span className="font-semibold tabular-nums">{money(costSum, undefined, 2)}</span>
                : <input value={costTotal} onChange={(e) => setCostTotal(e.target.value)} onBlur={(e) => filled(e.target.value) && setCostTotal(fmt(numOrZero(e.target.value)))}
                    inputMode="decimal" data-plain aria-label="ราคาที่ได้มารวม" placeholder={costRows.length ? fmt(costSum) : "ยอดรวม"} className={num} />}
                {!allCost && costRows.length > 0 && filled(costTotal) && !costShort && numOrZero(costTotal) - costSum > 0.005 &&
                  <span className="mt-1 block text-xs font-normal text-slate-500">ยังไม่แยก {money(numOrZero(costTotal) - costSum, undefined, 2)}</span>}</td>
              <td className="py-1 text-right">{valueRows.length
                ? <span className="font-semibold tabular-nums">{money(valueSum, undefined, 2)}</span>
                : <input value={valueTotal} onChange={(e) => setValueTotal(e.target.value)} onBlur={(e) => filled(e.target.value) && setValueTotal(fmt(numOrZero(e.target.value)))}
                    inputMode="decimal" data-plain aria-label="มูลค่ารวม" required={mode === "new" && !cost}
                    placeholder={mode === "edit" && currentValue != null ? money(currentValue, undefined, 2) : fromCost ? fmt(numOrZero(cost)) : "ยอดรวม"}
                    className={num} />}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <button type="button" onClick={() => setRows((rs) => [...rs, blank("LAND")])} className="text-blue-700 hover:underline">+ ที่ดิน (โฉนด)</button>
        <button type="button" onClick={() => setRows((rs) => [...rs, blank("BUILDING")])} className="text-blue-700 hover:underline">+ อาคาร</button>
        <button type="button" onClick={() => setRows((rs) => [...rs, blank("OTHER")])} className="text-blue-700 hover:underline">+ สิ่งปลูกสร้างอื่น</button>
        {rows.some((r) => r.type === "LAND") && (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500">ซื้อรวม: ยอดรวม</span>
            <input value={spreadTotal} onChange={(e) => setSpreadTotal(e.target.value)} inputMode="decimal" data-plain aria-label="ยอดรวมสำหรับเฉลี่ย"
              className="w-36 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm tabular-nums" />
            <button type="button" onClick={() => spread("acq_cost")} disabled={!numOrZero(spreadTotal)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50">เฉลี่ยเป็นต้นทุนที่ดินตามเนื้อที่</button>
            <button type="button" onClick={() => spread("value")} disabled={!numOrZero(spreadTotal)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50">เฉลี่ยเป็นมูลค่าที่ดินตามเนื้อที่</button>
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500">
        ซื้อหลายโฉนดเป็นแปลงเดียว: เพิ่มแถวละใบ แล้วใส่ยอดรวมกดเฉลี่ย (หักอาคาร / สิ่งปลูกสร้างที่ใส่เองก่อน ที่เหลือแบ่งให้ที่ดินตามเนื้อที่ · แก้รายแถวได้)
        · อาคารแต่ละหลังมีต้นทุน มูลค่า และอายุใช้งานของตัวเอง (ใช้หักค่าเสื่อมในราคาขายขั้นต่ำที่คุ้ม)
        · ไม่ใส่รายแถว = ใส่ยอดรวมที่แถวรวมอย่างเดียว{mode === "new" && " · ไม่ใส่มูลค่า = ใช้ยอดเดียวกับต้นทุน"}
      </p>
      {costShort && <p className="text-sm text-amber-700">ต้นทุนรวมน้อยกว่าผลรวมต้นทุนรายแถว ({money(costSum, undefined, 2)})</p>}
      {partial && <p className="text-sm text-amber-700">ใส่มูลค่าให้ครบทุกแถว หรือลบมูลค่ารายแถวออกให้หมดแล้วใส่ยอดรวม</p>}
      {valueChanged && (
        <div className="grid gap-3 rounded-lg bg-blue-50 p-3 md:grid-cols-4">
          <p className="text-xs text-blue-800 md:col-span-4">มูลค่าเปลี่ยน → บันทึกเป็นมูลค่าครั้งใหม่ (เก็บประวัติ ไม่ทับของเดิม)</p>
          <label className="text-sm">มูลค่า ณ วันที่<input name="valuation_date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 block ${cell}`} /></label>
          <label className="text-sm">วิธีประเมิน
            <select name="valuation_method" defaultValue="USER_ESTIMATE" className={`mt-1 block ${cell}`}>
              <option value="USER_ESTIMATE">ประมาณเอง</option>
              <option value="APPRAISAL">ผู้ประเมิน / ธนาคาร / ราชการ</option>
              <option value="LATEST_TRANSACTION">ราคาซื้อขายล่าสุด</option>
            </select></label>
          <label className="text-sm md:col-span-2">หมายเหตุของมูลค่า<input name="valuation_notes" className={`mt-1 block ${cell}`} /></label>
        </div>
      )}
    </div>
  );
}

function RowView({ r, set, remove, money2 }: {
  r: Row; set: (key: string, patch: Partial<Row>) => void; remove: (r: Row) => void;
  money2: (key: string, col: "acq_cost" | "value", v: string) => ReactNode;
}) {
  const t = (k: keyof Row, placeholder: string, extra = "") => (
    <input value={String(r[k] ?? "")} onChange={(e) => set(r.key, { [k]: e.target.value })} placeholder={placeholder} aria-label={placeholder}
      data-plain className={`${cell} ${extra}`} />
  );
  return (
    <>
      <tr className="align-top">
        <td className="py-1.5 pr-2">
          {r.type === "LAND" ? <span className="inline-block pt-1.5 text-sm">{COMP_TYPE_LABEL.LAND}</span> : (
            <select value={r.type} onChange={(e) => set(r.key, { type: e.target.value as CompType })} aria-label="ชนิด" className={cell}>
              <option value="BUILDING">{COMP_TYPE_LABEL.BUILDING}</option><option value="OTHER">{COMP_TYPE_LABEL.OTHER}</option>
            </select>
          )}
        </td>
        <td className="py-1.5 pr-2">
          {r.type === "LAND" ? (
            <div className="grid grid-cols-3 gap-1">{t("title_type", "ประเภท")}{t("title_deed_no", "เลขที่โฉนด")}{t("land_no", "เลขที่ดิน")}</div>
          ) : t("label", r.type === "BUILDING" ? "เช่น บ้านเดี่ยว 2 ชั้น" : "เช่น รั้ว · สระว่ายน้ำ · ระบบไฟ")}
        </td>
        <td className="py-1.5 pr-2">
          {r.type === "LAND" ? (
            <div className="flex gap-1">
              <input value={r.rai} onChange={(e) => set(r.key, { rai: e.target.value })} inputMode="numeric" data-plain placeholder="ไร่" aria-label="ไร่" className={cell} />
              <input value={r.ngan} onChange={(e) => set(r.key, { ngan: e.target.value })} inputMode="numeric" data-plain placeholder="งาน" aria-label="งาน" className={cell} />
              <input value={r.wa} onChange={(e) => set(r.key, { wa: e.target.value })} inputMode="decimal" data-plain placeholder="ตร.ว." aria-label="ตารางวา" className={cell} />
            </div>
          ) : r.type === "BUILDING" ? (
            <div className="flex items-center gap-1">
              <input value={r.building_area_sqm} onChange={(e) => set(r.key, { building_area_sqm: e.target.value })} inputMode="decimal" data-plain
                placeholder="พื้นที่ใช้สอย" aria-label="พื้นที่ใช้สอย (ตร.ม.)" className={cell} /><span className="text-xs text-slate-500">ตร.ม.</span>
            </div>
          ) : null}
        </td>
        <td className="py-1.5 pr-2"><input type="date" value={r.acquired_date} onChange={(e) => set(r.key, { acquired_date: e.target.value })}
          aria-label="วันที่ได้มา" title="ว่าง = วันที่ได้มาของทรัพย์สิน" className={cell} /></td>
        <td className="py-1.5 pr-2">{money2(r.key, "acq_cost", r.acq_cost)}</td>
        <td className="py-1.5 pr-2">{money2(r.key, "value", r.value)}</td>
        <td className="whitespace-nowrap py-1.5 text-right text-xs">
          <button type="button" onClick={() => set(r.key, { open: !r.open })} className="text-slate-600 hover:underline">{r.open ? "ย่อ" : "เพิ่มเติม"}</button>
          <button type="button" onClick={() => remove(r)} className="ml-2 text-red-600 hover:underline">ลบ</button>
        </td>
      </tr>
      {r.open && (
        <tr>
          <td></td>
          <td colSpan={6} className="pb-2">
            <div className="grid gap-2 rounded-lg bg-slate-50 p-2 md:grid-cols-5">
              {r.type === "LAND" ? (<>
                {t("deed_book", "เล่ม")}{t("deed_page", "หน้า")}{t("map_sheet", "ระวาง")}{t("survey_page", "หน้าสำรวจ")}
              </>) : (
                <label className="flex items-center gap-1 text-xs text-slate-600">อายุใช้งาน
                  <input value={r.useful_life_years} onChange={(e) => set(r.key, { useful_life_years: e.target.value })} inputMode="numeric" data-plain
                    aria-label="อายุใช้งาน (ปี)" className={`${cell} w-16`} />ปี</label>
              )}
              <div className={r.type === "LAND" ? "" : "md:col-span-4"}>{t("notes", "หมายเหตุ")}</div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

