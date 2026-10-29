"use client";

import { useActionState, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { demolishComponents, payForAsset, sellAsset, undoComponentEvent, type TradeState } from "@/lib/asset-trade";
import { money } from "@/lib/format";
import BalanceGuard from "@/components/BalanceGuard";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
type Bank = { asset_id: string; name: string; currency: string };

function Box({ title, label, children, action, pending, state, danger }: {
  title: string; label: string; children: React.ReactNode; action: (f: FormData) => void; pending: boolean; state: TradeState; danger?: boolean;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const trigger = (
    <button type="button" onClick={() => setOpen(!open)}
      className={activeCls(`rounded-md border bg-white px-4 py-2 text-sm hover:bg-slate-50 ${danger ? "border-amber-300 text-amber-800" : "border-slate-300"}`)}>{label}</button>
  );
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="w-full space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="font-medium text-slate-900">{title}</h3>
      {children}
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  ));
}

/** Property: แถวส่วนประกอบที่ยังถืออยู่ + มูลค่าในมูลค่าล่าสุด (null = มูลค่าล่าสุดยังไม่แยกรายแถว) */
export type SaleComp = { id: string; label: string; type: "LAND" | "BUILDING" | "OTHER"; value: number | null };

/** เลือกแถวที่ขาย / รื้อถอน + มูลค่าเดิมของแถวที่เลือก (มูลค่าล่าสุดไม่แยกรายแถว → ผู้ใช้ใส่) */
function CompPicker({ comps, currency }: { comps: SaleComp[]; currency: string }) {
  const [sel, setSel] = useState<string[]>([]);
  const known = comps.every((c) => c.value != null);
  const book = comps.filter((c) => sel.includes(c.id)).reduce((t, c) => t + (c.value ?? 0), 0);
  const toggle = (id: string, on: boolean) => setSel(on ? [...sel, id] : sel.filter((x) => x !== id));
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {comps.map((c) => (
          <label key={c.id} className="flex items-center gap-2">
            <input type="checkbox" name="comp" value={c.id} checked={sel.includes(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} />
            {c.label}{c.value != null && <span className="text-xs tabular-nums text-slate-500">มูลค่า {money(c.value, undefined, 0)}</span>}
          </label>
        ))}
      </div>
      {known ? (sel.length > 0 && <p className="mt-1 text-xs text-slate-600">มูลค่าเดิมของแถวที่เลือก <span className="tabular-nums">{money(book, currency, 0)}</span> (ตามมูลค่าล่าสุดรายแถว)</p>) : (
        <label className="mt-2 block text-sm">มูลค่าเดิมของแถวที่เลือก ({currency}) *
          <input name="book_value" required inputMode="decimal" className={`${input} md:w-60`} />
          <span className="text-xs text-slate-500">มูลค่าล่าสุดยังเป็นยอดรวมอย่างเดียว ใส่ว่าแถวที่เลือกมีมูลค่าเท่าไรในยอดนั้น</span>
        </label>
      )}
    </div>
  );
}

export function SellAssetForm({ assetId, currency, banks, today, minDate, paths, hasLease, quantity, unit, components }: {
  assetId: string; currency: string; banks: Bank[]; today: string; minDate: string; paths: string[]; hasLease?: boolean;
  /** Alternative: จำนวนที่ถืออยู่ → ขายบางส่วนได้ (ไม่ส่ง = ขายทั้งรายการเท่านั้น) */
  quantity?: number | null; unit?: string | null;
  /** Property: แถวส่วนประกอบที่ยังถืออยู่ (2 แถวขึ้นไป → ขายบางแถวได้) */
  components?: SaleComp[];
}) {
  const [state, action, pending] = useActionState<TradeState, FormData>(sellAsset, {});
  const [part, setPart] = useState(false);
  const list = banks.filter((b) => b.currency === currency);
  const qtyText = quantity ? quantity.toLocaleString("en-US", { maximumFractionDigits: 8 }) : "";
  const canPart = (components?.length ?? 0) > 1;
  return (
    <Box title="บันทึกการขาย" label="ขายทรัพย์สินนี้" action={action} pending={pending} state={state} danger>
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="paths" value={paths.join(",")} />
      {canPart && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="scope" value="all" checked={!part} onChange={() => setPart(false)} /> ขายทั้งทรัพย์สิน</label>
            <label className="flex items-center gap-2"><input type="radio" name="scope" value="part" checked={part} onChange={() => setPart(true)} /> ขายบางแถว (เช่น ที่ดินบางแปลง)</label>
          </div>
          {part && <CompPicker comps={components!} currency={currency} />}
        </div>
      )}
      {quantity ? (
        <div className="grid gap-3 md:grid-cols-4">
          <input type="hidden" name="total_quantity" value={String(quantity)} />
          <label className="text-sm">จำนวนที่ขาย{unit ? ` (${unit})` : ""} *
            <input name="quantity" required inputMode="decimal" data-money="off" defaultValue={String(quantity)} className={input} />
          </label>
          <p className="self-end pb-2 text-xs text-slate-500 md:col-span-3">ถืออยู่ {qtyText}{unit ? ` ${unit}` : ""} · ใส่น้อยกว่านี้ = ขายบางส่วน (ยังถืออยู่) · ใส่เท่ากัน = ขายทั้งรายการ</p>
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-4">
        <label className="text-sm">วันที่ขาย *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className="text-sm">ราคาขาย ({currency}) *<input name="price" required inputMode="decimal" className={input} /></label>
        <label className="text-sm">ค่าใช้จ่ายในการขาย<input name="fee" inputMode="decimal" placeholder="ค่าโอน / นายหน้า / ภาษี" className={input} /></label>
        <label className="text-sm">เงินเข้าบัญชี
          <select name="bank_asset_id" defaultValue={list[0]?.asset_id ?? ""} className={input}>
            <option value="">— ไม่ผ่านบัญชี (เช่น แลกเปลี่ยน) —</option>
            {list.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
          </select>
        </label>
        <label className="text-sm md:col-span-4">หมายเหตุ<input name="notes" placeholder="ผู้ซื้อ / เลขที่สัญญา" className={input} /></label>
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-500">
        <li>เงินเข้าบัญชี = ราคาขาย − ค่าใช้จ่าย · กำไร / ขาดทุน = เงินเข้าบัญชี − {part ? "มูลค่าเดิมของแถวที่ขาย" : "มูลค่าล่าสุด"} → ลงเป็นรายได้ / ค่าใช้จ่ายของเจ้าของตามสัดส่วน (ขาดทุนไม่มีเงินออกจากบัญชี)</li>
        {part ? <li>ขายบางแถว: แถวที่ขายเป็น &ldquo;ขายแล้ว&rdquo; (ยังเห็นในประวัติ) · มูลค่าใหม่ = มูลค่าเดิม − ส่วนที่ขาย · ราคาที่ได้มาลดตามต้นทุนของแถวนั้น · ทรัพย์สินยังถืออยู่</li>
          : <li>{quantity ? "ขายทั้งรายการ: " : ""}บันทึกมูลค่า ณ วันขาย = ราคาขาย แล้วเปลี่ยนสถานะเป็น &ldquo;ขายแล้ว&rdquo; (ไม่นับใน Net Worth หลังวันขาย)</li>}
        {quantity ? <li>ขายบางส่วน: มูลค่าส่วนที่ขาย = มูลค่าล่าสุด × จำนวนที่ขาย ÷ {qtyText} · ขายตามสัดส่วนเจ้าของทุกคน · จำนวน / มูลค่า / ราคาทุนที่เหลือลดตามสัดส่วน</li> : null}
        {hasLease && !part && <li className="text-amber-700">ถ้ายังมีสัญญาเช่าที่มีผลหลังวันขาย ต้องบันทึกเลิกสัญญา / คืนเงินประกันก่อน</li>}
      </ul>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" /> ยืนยันว่าขายแล้วจริง</label>
    </Box>
  );
}

/** Property: รื้อถอนอาคาร / สิ่งปลูกสร้าง → แถวเป็น "รื้อถอนแล้ว" · มูลค่าของแถวออก · ขาดทุนเท่ามูลค่าเดิม (ตกลง 29 ต.ค. 2026) */
export function DemolishForm({ assetId, currency, banks, today, minDate, paths, components }: {
  assetId: string; currency: string; banks: Bank[]; today: string; minDate: string; paths: string[]; components: SaleComp[];
}) {
  const [state, action, pending] = useActionState<TradeState, FormData>(demolishComponents, {});
  const list = banks.filter((b) => b.currency === currency);
  return (
    <Box title="บันทึกการรื้อถอน" label="รื้อถอน" action={action} pending={pending} state={state} danger>
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="paths" value={paths.join(",")} />
      <CompPicker comps={components} currency={currency} />
      <div className="grid gap-3 md:grid-cols-4">
        <label className="text-sm">วันที่รื้อถอน *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className="text-sm">ขายเศษวัสดุได้ ({currency})<input name="price" inputMode="decimal" placeholder="ถ้ามี" className={input} /></label>
        <label className="text-sm">ค่าใช้จ่ายที่หักจากเงินนั้น<input name="fee" inputMode="decimal" className={input} /></label>
        <label className="text-sm">เงินเข้าบัญชี
          <select name="bank_asset_id" defaultValue="" className={input}>
            <option value="">— ไม่มีเงินเข้า —</option>
            {list.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
          </select>
        </label>
        <label className="text-sm md:col-span-4">หมายเหตุ<input name="notes" placeholder="เหตุผล / ผู้รับเหมา" className={input} /></label>
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-500">
        <li>มูลค่าของแถวที่รื้อออกจากมูลค่าทรัพย์สิน · ขาดทุน = มูลค่าเดิม − เงินขายเศษวัสดุ → ค่าใช้จ่ายของเจ้าของตามสัดส่วน (ไม่มีเงินออกจากบัญชี)</li>
        <li>ค่าจ้างรื้อถอนที่จ่ายจริง ให้บันทึกเป็นค่าใช้จ่ายแยก · สร้างหลังใหม่ใช้ &ldquo;จ่ายซื้อ / จ่ายเพิ่ม&rdquo; → อาคารใหม่</li>
      </ul>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" /> ยืนยันว่ารื้อถอนแล้วจริง</label>
    </Box>
  );
}

export function PayAssetForm({ assetId, currency, banks, today, minDate, paths, label = "+ จ่ายซื้อ / จ่ายเพิ่ม", property = false, components = [] }: {
  assetId: string; currency: string; banks: Bank[]; today: string; minDate: string; paths: string[]; label?: string;
  /** Property: ติ๊ก "เพิ่มมูลค่าตามยอดนี้" (ค่าตั้งต้น) + "อาคาร / สิ่งปลูกสร้าง" (หักค่าเสื่อม · ราคาขายขั้นต่ำที่คุ้ม) */ property?: boolean;
  /** Property: ส่วนประกอบที่เลือกได้ (จ่ายเพิ่มของแถวไหน) */ components?: CompOpt[];
}) {
  const [state, action, pending] = useActionState<TradeState, FormData>(payForAsset, {});
  const list = banks.filter((b) => b.currency === currency);
  return (
    <Box title="จ่ายเงินซื้อ / จ่ายเพิ่มจากบัญชี" label={label} action={action} pending={pending} state={state}>
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="paths" value={paths.join(",")} />
      <div className="grid gap-3 md:grid-cols-4">
        <label className="text-sm">วันที่ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className="text-sm">จ่ายจากบัญชี *
          <select name="bank_asset_id" required className={input}>{list.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}</select>
        </label>
        <label className="text-sm">จำนวนเงิน ({currency}) *<input name="amount" required inputMode="decimal" className={input} /></label>
        <label className="text-sm">ค่าธรรมเนียมโอน<input name="fee" inputMode="decimal" className={input} /></label>
        <BalanceGuard amount={["amount", "fee"]} />
        <label className="text-sm md:col-span-4">รายละเอียด<input name="description" placeholder="เช่น ผ่อนดาวน์งวด 3 / ต่อเติมห้องครัว" className={input} /></label>
        {property && <PropertyPayExtras components={components} allowNew />}
      </div>
      {list.length === 0 && <p className="text-xs text-amber-700">ไม่มีบัญชีสกุล {currency} ที่ใช้งานอยู่</p>}
      <p className="text-xs text-slate-500">เงินออกจากบัญชีไปเป็นทรัพย์สิน (ไม่ใช่ค่าใช้จ่าย) · {property
        ? "ติ๊กเพิ่มมูลค่า → มูลค่าใหม่ = มูลค่าล่าสุด + ยอดจ่าย (แก้ / ลบรายการจ่ายแล้วมูลค่าปรับตาม)"
        : "มูลค่าทรัพย์สินไม่เปลี่ยนเอง ให้อัปเดตมูลค่าหลังบันทึก"}</p>
    </Box>
  );
}

/** ส่วนประกอบของ Property ที่ให้เลือกในฟอร์มจ่าย (ที่ดิน / อาคาร / สิ่งปลูกสร้างอื่น) */
export type CompOpt = { id: string; label: string; type: "LAND" | "BUILDING" | "OTHER" };
const TYPE_TEXT: Record<CompOpt["type"], string> = { LAND: "ที่ดิน", BUILDING: "อาคาร", OTHER: "สิ่งปลูกสร้างอื่น" };
const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";

/** ช่องเพิ่มของ Property (ใช้ทั้งตอนจ่ายและตอนแก้รายการจ่าย · ตกลง 28–29 ต.ค. 2026)
 *  เพิ่มมูลค่าตามยอดนี้ · เป็นของส่วนประกอบไหน (ต้องเลือก · หรือแถวใหม่: ซื้อที่ดินเพิ่ม / อาคาร / สิ่งปลูกสร้าง · เฉพาะตอนจ่าย)
 *  อาคาร / สิ่งปลูกสร้าง = ตามชนิดของแถวที่เลือก (หักค่าเสื่อมตามอายุของแถวนั้น · ไม่มีติ๊กอาคารแยก ตกลง 29 ต.ค. 2026) */
export function PropertyPayExtras({ addValue = true, showAddValue = true, components = [], component = "", allowNew = false }: {
  addValue?: boolean; showAddValue?: boolean;
  components?: CompOpt[]; /** แถวที่เลือกไว้ (แก้รายการจ่าย) */ component?: string; /** ตอนจ่าย: สร้างแถวใหม่ได้ */ allowNew?: boolean;
}) {
  const [pick, setPick] = useState(component);
  const isNew = pick.startsWith("new:");
  const newType = pick.slice(4) as CompOpt["type"];
  const pickType = isNew ? newType : components.find((c) => c.id === pick)?.type;
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 px-3 py-2 text-sm md:col-span-4">
      <input type="hidden" name="property" value="1" />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {showAddValue && <label className="flex items-center gap-2"><input type="checkbox" name="add_value" defaultChecked={addValue} /> เพิ่มมูลค่าทรัพย์สินตามยอดนี้</label>}
        {(components.length > 0 || allowNew) && (
          <label className="flex items-center gap-2">เป็นของ *
            <select name="component" required value={pick} onChange={(e) => setPick(e.target.value)} className={small}>
              <option value="" disabled>— เลือกแถว —</option>
              {(["LAND", "BUILDING", "OTHER"] as const).map((t) => components.some((c) => c.type === t) && (
                <optgroup key={t} label={TYPE_TEXT[t]}>
                  {components.filter((c) => c.type === t).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </optgroup>
              ))}
              {allowNew && (
                <optgroup label="แถวใหม่">
                  <option value="new:LAND">+ ซื้อที่ดินเพิ่ม (โฉนดใหม่)</option>
                  <option value="new:BUILDING">+ อาคารใหม่</option>
                  <option value="new:OTHER">+ สิ่งปลูกสร้างอื่นใหม่</option>
                </optgroup>
              )}
            </select></label>
        )}
      </div>
      {isNew && (newType === "LAND" ? (
        <div className="flex flex-wrap items-center gap-2">
          <input name="nc_title_deed_no" placeholder="เลขที่โฉนด" aria-label="เลขที่โฉนด" data-plain className={`w-32 ${small}`} />
          <input name="nc_land_no" placeholder="เลขที่ดิน" aria-label="เลขที่ดิน" data-plain className={`w-28 ${small}`} />
          <span className="text-xs text-slate-500">เนื้อที่</span>
          <input name="nc_rai" placeholder="ไร่" aria-label="ไร่" inputMode="numeric" data-plain className={`w-16 ${small}`} />
          <input name="nc_ngan" placeholder="งาน" aria-label="งาน" inputMode="numeric" data-plain className={`w-16 ${small}`} />
          <input name="nc_wa" placeholder="ตร.ว." aria-label="ตารางวา" inputMode="decimal" data-plain className={`w-20 ${small}`} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input name="nc_label" required placeholder={newType === "BUILDING" ? "ชื่ออาคาร เช่น บ้านหลังเล็ก" : "เช่น รั้ว · สระว่ายน้ำ"} aria-label="ชื่อ"
            className={`w-64 ${small}`} />
          {newType === "BUILDING" && <><input name="nc_area" placeholder="พื้นที่ใช้สอย" aria-label="พื้นที่ใช้สอย (ตร.ม.)" inputMode="decimal" data-plain
            className={`w-28 ${small}`} /><span className="text-xs text-slate-500">ตร.ม.</span></>}
          <span className="text-xs text-slate-500">อายุใช้งาน</span>
          <input name="nc_years" defaultValue="20" aria-label="อายุใช้งาน (ปี)" inputMode="numeric" data-plain className={`w-16 text-right ${small}`} />
          <span className="text-xs text-slate-500">ปี</span>
        </div>
      ))}
      {pick && <p className="text-xs text-slate-500">ต้นทุนและมูลค่าที่เพิ่มเข้าแถวที่เลือก{isNew && " (แถวใหม่ วันที่ได้มา = วันที่จ่าย · แก้รายละเอียดได้ที่ปุ่มแก้ไขของทรัพย์สิน)"}
        {pickType && pickType !== "LAND" && " · อาคาร / สิ่งปลูกสร้างหักค่าเสื่อมตามอายุของแถวนั้น"}</p>}
    </div>
  );
}

/** Property: ยกเลิกการขายบางแถว / รื้อถอน (เฉพาะครั้งล่าสุด) · กด 2 ครั้งเพื่อยืนยัน */
export function UndoComponentEvent({ eventId, paths }: { eventId: string; paths: string[] }) {
  const [state, action, pending] = useActionState<TradeState, FormData>(undoComponentEvent, {});
  const [ask, setAsk] = useState(false);
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="paths" value={paths.join(",")} />
      {ask ? <>
        <button disabled={pending} className="rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-50 disabled:opacity-50">
          {pending ? "กำลังยกเลิก…" : "ยืนยันยกเลิก"}</button>
        <button type="button" onClick={() => setAsk(false)} className="text-xs text-slate-500">ไม่ใช่</button>
      </> : <button type="button" onClick={() => setAsk(true)} className="text-xs text-slate-500 underline hover:text-slate-700">ยกเลิกรายการนี้</button>}
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
