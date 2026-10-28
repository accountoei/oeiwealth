"use client";

import Link from "next/link";
import { useActionState, useState, type ChangeEvent } from "react";
import { createProperty, type ActionState } from "../actions";
import OwnerShares from "@/components/OwnerShares";
import LeaseFields, { type Bank } from "../LeaseFields";
import { PROPERTY_TYPE_LABEL, USAGE_LABEL, numOrZero, thDate } from "@/lib/format";
import { CurrencySelect } from "@/components/CurrencyContext";
import { useCostValueMirror } from "@/components/useCostValueMirror";
import AcqBuildingFields from "../AcqBuildingFields";
import { partsSum, splitByArea } from "../valueParts";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-sm text-slate-700";

export default function NewPropertyForm(props: {
  persons: { id: string; name: string }[]; banks: Bank[];
  goLive: string; openingDate: string; today: string; isSetup: boolean; isAdmin: boolean;
}) {
  const { persons, banks, goLive, openingDate, today, isSetup, isAdmin } = props;
  const [state, action, pending] = useActionState<ActionState, FormData>(createProperty, {});
  const [opening, setOpening] = useState(isSetup);
  // หลัง Go-live: ซ่อนตัวเลือก "มีอยู่ก่อน Go-live" (ไม่ติ๊ก) · ADMIN กดลิงก์เล็กเพื่อเพิ่มรายการที่ตกหล่น
  const [late, setLate] = useState(false);
  const [usage, setUsage] = useState("OWNER_OCCUPIED");
  const [currency, setCurrency] = useState("THB");
  const m = useCostValueMirror();

  return (
    <form action={action} className="space-y-6">
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2">
        <h2 className="md:col-span-2 font-medium text-slate-900">ข้อมูลทรัพย์สิน</h2>
        {!isSetup && isAdmin && !late && (
          <button type="button" onClick={() => setLate(true)} className="md:col-span-2 text-left text-xs text-slate-400 underline hover:text-slate-600">เพิ่มรายการที่ตกหล่นก่อน Go-live (ADMIN)</button>
        )}
        {(isSetup || late) && (
          <label className="md:col-span-2 flex items-start gap-2 text-sm">
            <input type="checkbox" name="is_opening" checked={opening} onChange={(e) => setOpening(e.target.checked)} className="mt-1" />
            <span>
              มีอยู่ก่อน Go-live ({thDate(goLive)}) — ใช้เป็น <b>มูลค่าตั้งต้น</b> ณ สิ้นวัน {thDate(openingDate)}
              {!isSetup && <span className="block text-xs text-amber-700">ระบบ LIVE แล้ว: ต้องระบุเหตุผลในหมายเหตุ</span>}
            </span>
          </label>
        )}
        <label className={label}>ชื่อที่ใช้เรียก *<input name="name" required placeholder="เช่น บ้านบางนา" className={input} /></label>
        <label className={label}>ประเภท *
          <select name="property_type" defaultValue="HOUSE" className={input}>
            {Object.entries(PROPERTY_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className={label}>การใช้งาน *
          <select name="usage_type" value={usage} onChange={(e) => setUsage(e.target.value)} className={input}>
            {Object.entries(USAGE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className={label}>สกุลเงิน
          <CurrencySelect name="currency" value={currency} onChange={setCurrency} className={input} />
        </label>
        <label className={label}>กลุ่มทำเล<input name="location_group" placeholder="เช่น กรุงเทพ · เชียงใหม่" className={input} /></label>
        <label className={label}>ที่อยู่<input name="address" className={input} /></label>
        <DeedRows getTotal={() => numOrZero(m.valueProps.ref.current?.value)} setTotal={(v) => {
          const el = m.valueProps.ref.current; if (!el) return;
          el.value = v; m.valueProps.onChange({ target: el } as ChangeEvent<HTMLInputElement>);
        }} />
        <label className={label}>วันที่ได้มา {!opening && "*"}
          <input name="acquisition_date" type="date" required={!opening} min={opening ? undefined : goLive} max={today} {...m.acqDateProps} className={input} />
        </label>
        <label className={label}>ราคาที่ได้มา<input name="acquisition_cost" inputMode="decimal" {...m.costProps} className={input} />{m.copied === "cost" && <span className="mt-1 block text-xs text-slate-400">ใช้ยอดเดียวกับมูลค่า · แก้ได้</span>}</label>
        <AcqBuildingFields className={label} />
        <label className={label}>มูลค่า *<input name="value" required inputMode="decimal" {...m.valueProps} className={input} />{m.copied === "value" && <span className="mt-1 block text-xs text-slate-400">ใช้ยอดเดียวกับราคาที่ได้มา · แก้ได้</span>}</label>
        <label className={label}>มูลค่า ณ วันที่ *
          {opening
            ? <><input type="hidden" name="value_date" value={openingDate} /><input disabled value={thDate(openingDate)} className={`${input} bg-slate-50`} /></>
            : <input name="value_date" type="date" required min={goLive} max={today} defaultValue={today} {...m.valDateProps} className={input} />}
        </label>
        <label className={label}>วิธีประเมิน
          <select name="valuation_method" defaultValue="USER_ESTIMATE" {...m.methodProps} className={input}>
            <option value="USER_ESTIMATE">ประมาณเอง</option>
            <option value="APPRAISAL">ประเมินโดยผู้ประเมิน / ธนาคาร</option>
            <option value="BOOK_VALUE">ราคาทุน</option>
            <option value="LATEST_TRANSACTION">ราคาซื้อขายล่าสุด</option>
          </select>
        </label>
        {!opening && (
          <label className={label}>จ่ายจากบัญชี
            <select name="pay_bank_asset_id" defaultValue="" className={input}>
              <option value="">— ไม่บันทึกเงินออก (ยังไม่จ่าย / จ่ายเป็นงวด) —</option>
              {banks.filter((b) => b.currency === currency).map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">เลือกบัญชี → บันทึกเงินออก &ldquo;ซื้อทรัพย์สิน&rdquo; = ราคาที่ได้มา ณ วันที่ได้มา · จ่ายเป็นงวด ให้เว้นว่างแล้วใช้ &ldquo;+ จ่ายซื้อ / จ่ายเพิ่ม&rdquo; ในหน้าทรัพย์สิน</span>
          </label>
        )}
        <label className={`${label} md:col-span-2`}>หมายเหตุ {opening && !isSetup && "(เหตุผล · จำเป็น)"}
          <textarea name="notes" rows={2} required={opening && !isSetup} className={input} />
        </label>
      </section>

      <OwnerShares persons={persons} title="เจ้าของ" hint="สัดส่วนกรรมสิทธิ์ · ใช้แบ่งมูลค่า ค่าเช่า และหนี้เงินประกันตามสัดส่วน" />

      {usage === "RENTAL" && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium text-slate-900">สัญญาเช่าปัจจุบัน</h2>
          <p className="text-xs text-slate-500">ถ้ายังไม่มีผู้เช่า ให้เลือกการใช้งานเป็น &ldquo;ว่าง&rdquo; แล้วเพิ่มสัญญาภายหลัง</p>
          <LeaseFields banks={banks} goLive={goLive} currency={currency} />
        </section>
      )}

      {state.error && <p className="text-sm text-red-600">{state.error}{state.created && <> · <Link href={state.created} className="underline">เปิดหน้าทรัพย์สิน</Link></>}</p>}
      <div className="flex gap-3">
        <button disabled={pending || !!state.created} className="rounded-md bg-blue-600 px-5 py-2 text-sm text-white disabled:opacity-50">
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <Link href="/property" className="rounded-md border border-slate-300 px-5 py-2 text-sm">ยกเลิก</Link>
      </div>
    </form>
  );
}

const cell = "w-full rounded-md border border-slate-300 px-2 py-2 text-sm";
const fmt2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** โฉนด / เอกสารสิทธิ์ + มูลค่าแยกตามโฉนด / อาคาร (ตกลง 28 ต.ค. 2026)
 *  ใบแรก = ช่องหลักเดิม (ระบบสร้างโฉนดใบแรกให้) · ใบอื่น = x_* · เนื้อที่ของทรัพย์สิน = ผลรวมทุกใบ
 *  มูลค่ารายส่วน (ไม่บังคับ): ใส่แล้วช่อง "มูลค่า" = ผลรวมให้ · หรือใส่ "มูลค่า" แล้วกดเฉลี่ยตามเนื้อที่ (หักอาคารที่ใส่เองก่อน) */
function DeedRows({ getTotal, setTotal }: { getTotal: () => number; setTotal: (v: string) => void }) {
  const [n, setN] = useState(1);
  const [vals, setVals] = useState<string[]>([""]);
  const [areas, setAreas] = useState<number[]>([0]);
  const [blds, setBlds] = useState<{ key: number; type: "BUILDING" | "OTHER"; label: string; value: string }[]>([]);
  const sync = (dv: string[], bl: typeof blds) => {
    const all = [...dv, ...bl.map((b) => b.value)].filter((v) => v.trim() !== "");
    if (all.length) setTotal(fmt2(partsSum(all.map((v) => ({ value: numOrZero(v) })))));
  };
  const setVal = (i: number, v: string) => { const next = vals.slice(); next[i] = v; setVals(next); sync(next, blds); };
  const setBld = (key: number, patch: Partial<(typeof blds)[number]>) => {
    const next = blds.map((b) => (b.key === key ? { ...b, ...patch } : b)); setBlds(next); if ("value" in patch) sync(vals, next);
  };
  const area = (i: number, f: HTMLElement | null) => {
    const row = f?.closest("[data-deed-row]"); if (!row) return;
    const g = (k: string) => numOrZero((row.querySelector(`[data-k="${k}"]`) as HTMLInputElement | null)?.value);
    const next = areas.slice(); next[i] = g("rai") * 400 + g("ngan") * 100 + g("wa"); setAreas(next);
  };
  const spread = () => {
    const rest = getTotal() - partsSum(blds.map((b) => ({ value: numOrZero(b.value) })));
    const out = splitByArea(rest, areas.slice(0, n)).map(fmt2);
    setVals(out);
  };
  const row = (i: number) => {
    const k = (f: string) => (i === 0 ? f : `x_${f}`);
    return (
      <div key={i} data-deed-row className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_2fr_1fr_auto] md:items-center">
        <input name={k("title_type")} placeholder="ประเภท เช่น โฉนด · น.ส.3ก · อ.ช.2" aria-label="ประเภทเอกสารสิทธิ์" className={cell} />
        <input name={k("title_deed_no")} placeholder="เลขที่โฉนด" aria-label="เลขที่โฉนด" className={cell} />
        <input name={k("land_no")} placeholder="เลขที่ดิน" aria-label="เลขที่ดิน" className={cell} />
        <div className="flex gap-2" onChange={(e) => area(i, e.target as HTMLElement)}>
          <input name={k("land_rai")} data-k="rai" inputMode="numeric" placeholder="ไร่" aria-label="ไร่" className={cell} />
          <input name={k("land_ngan")} data-k="ngan" inputMode="numeric" placeholder="งาน" aria-label="งาน" className={cell} />
          <input name={k("land_wa")} data-k="wa" inputMode="decimal" placeholder="ตร.ว." aria-label="ตารางวา" className={cell} />
        </div>
        <input name={k("part_value")} value={vals[i] ?? ""} onChange={(e) => setVal(i, e.target.value)} inputMode="decimal" data-plain
          placeholder="มูลค่า (ไม่บังคับ)" aria-label="มูลค่าโฉนดใบนี้" className={`${cell} text-right tabular-nums`} />
        {i > 0 && i === n - 1
          ? <button type="button" onClick={() => { setN(n - 1); const v = vals.slice(0, n - 1); setVals(v); setAreas(areas.slice(0, n - 1)); sync(v, blds); }}
              className="text-xs text-red-600 hover:underline">ลบแถว</button>
          : <span className="hidden md:block md:w-10" />}
      </div>
    );
  };
  return (
    <div className="md:col-span-2 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-slate-700">โฉนด / เอกสารสิทธิ์ · เนื้อที่ (ไร่-งาน-ตารางวา) · มูลค่า</span>
        <span className="flex flex-wrap gap-3 text-sm">
          <button type="button" onClick={() => { setN(n + 1); setVals([...vals, ""]); setAreas([...areas, 0]); }} className="text-blue-700 hover:underline">+ เพิ่มโฉนดอีกใบ</button>
          <button type="button" onClick={() => setBlds([...blds, { key: Date.now(), type: "BUILDING", label: "", value: "" }])} className="text-blue-700 hover:underline">+ อาคาร</button>
        </span>
      </div>
      {Array.from({ length: n }, (_, i) => row(i))}
      {blds.map((b) => (
        <div key={b.key} className="grid gap-2 md:grid-cols-[1fr_4fr_1fr_auto] md:items-center">
          <input type="hidden" name="b_type" value={b.type} />
          <select value={b.type} onChange={(e) => setBld(b.key, { type: e.target.value as "BUILDING" | "OTHER" })} aria-label="ประเภทส่วน" className={cell}>
            <option value="BUILDING">อาคาร / สิ่งปลูกสร้าง</option><option value="OTHER">อื่น ๆ</option>
          </select>
          <input name="b_label" value={b.label} onChange={(e) => setBld(b.key, { label: e.target.value })} placeholder="เช่น บ้านเดี่ยว 3 ชั้น" aria-label="ชื่อส่วน" className={cell} />
          <input name="b_value" value={b.value} onChange={(e) => setBld(b.key, { value: e.target.value })} inputMode="decimal" data-plain placeholder="มูลค่า"
            aria-label="มูลค่า" className={`${cell} text-right tabular-nums`} />
          <button type="button" onClick={() => { const next = blds.filter((x) => x.key !== b.key); setBlds(next); sync(vals, next); }}
            className="text-xs text-red-600 hover:underline">ลบแถว</button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={spread} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50">เฉลี่ย &ldquo;มูลค่า&rdquo; ให้โฉนดตามเนื้อที่</button>
        <p className="text-xs text-slate-400">ซื้อหลายโฉนดเป็นแปลงเดียว: เพิ่มแถวละใบ · เนื้อที่รวมให้อัตโนมัติ · มูลค่ารายส่วนไม่บังคับ: ใส่แล้วช่อง &ldquo;มูลค่า&rdquo; รวมให้ หรือใส่ &ldquo;มูลค่า&rdquo; แล้วกดเฉลี่ย (หักอาคารที่ใส่เองก่อน) · ค่าอาคารตอนประเมินต้องใส่เอง</p>
      </div>
    </div>
  );
}
