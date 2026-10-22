"use client";

import { useActionState, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { buyShares, recordDividend, sellShares, undoShareSale, updateBusinessInfo, type ActionState } from "../actions";
import { money, qty } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import BalanceGuard from "@/components/BalanceGuard";
import BusinessBadge from "../badge";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
type Bank = { asset_id: string; name: string; currency: string };

function Box({ title, label, children, action, pending, state }: {
  title: string; label: string; children: React.ReactNode; action: (f: FormData) => void; pending: boolean; state: ActionState;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls("rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50")}>{label}</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="w-full space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="font-medium text-slate-900">{title}</h3>
      {children}
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  ));
}

export function DividendForm({ assetId, banks, today, minDate }: { assetId: string; banks: Bank[]; today: string; minDate: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(recordDividend, {});
  return (
    <Box title="รับเงินปันผลจากกิจการ" label="+ รับปันผล" action={action} pending={pending} state={state}>
      <input type="hidden" name="asset_id" value={assetId} />
      <div className="grid gap-3 md:grid-cols-4">
        <label className="text-sm">วันที่ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className="text-sm">ยอดก่อนหักภาษี *<input name="amount" required inputMode="decimal" className={input} /></label>
        <label className="text-sm">ภาษีหัก ณ ที่จ่าย<input name="tax" inputMode="decimal" className={input} /></label>
        <label className="text-sm">เข้าบัญชี
          <select name="bank_asset_id" defaultValue={banks[0]?.asset_id ?? ""} className={input}>
            <option value="">— ไม่ผ่านบัญชี —</option>{banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name} ({b.currency})</option>)}
          </select>
        </label>
        <label className="text-sm md:col-span-4">หมายเหตุ<input name="notes" className={input} /></label>
      </div>
      <p className="text-xs text-slate-500">บันทึกเป็นรายได้ &ldquo;ปันผลกิจการ&rdquo; แบ่งตามสัดส่วนเจ้าของ</p>
    </Box>
  );
}

/** แก้รายละเอียดธุรกิจ (ชื่อรายการ · ข้อมูลบริษัท · หุ้น · เงินลงทุน · หมายเหตุ) */
export function BusinessInfoForm({ assetId, byShares, v }: {
  assetId: string; byShares: boolean;
  v: { name: string; logo_data: string | null; company_name: string; registration_no: string | null; business_type: string | null; total_shares: number | null; par_value: number | null;
    shares_owned: number | null; company_ownership_percent: number | null; investment_cost: number | null; notes: string | null };
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateBusinessInfo, {});
  const dv = (x: number | null) => (x == null ? "" : String(Number(x)));
  return (
    <form action={action} className="grid gap-3 md:grid-cols-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <label className="text-sm">ชื่อรายการ *<input name="name" required defaultValue={v.name} className={input} /></label>
      <label className="text-sm md:col-span-2">ชื่อบริษัท *<input name="company_name" required defaultValue={v.company_name} className={input} /></label>
      <label className="text-sm">เลขทะเบียน<input name="registration_no" defaultValue={v.registration_no ?? ""} className={input} /></label>
      <label className="text-sm">ประเภทกิจการ<input name="business_type" defaultValue={v.business_type ?? ""} className={input} /></label>
      <label className="text-sm">เงินลงทุน<input name="investment_cost" inputMode="decimal" defaultValue={dv(v.investment_cost)} className={input} /></label>
      <label className="text-sm">หุ้นทั้งหมดของบริษัท<input name="total_shares" inputMode="decimal" data-money="off" defaultValue={dv(v.total_shares)} className={input} /></label>
      <label className="text-sm">มูลค่าหุ้นที่ตราไว้ (par · บาท/หุ้น)<input name="par_value" inputMode="decimal" defaultValue={dv(v.par_value)} className={input} /></label>
      {byShares ? (
        <p className="self-end text-xs text-slate-500 md:col-span-2">หุ้นที่ครอบครัวถือ และ % ของบริษัท คำนวณจากจำนวนหุ้นของสมาชิก (แก้ที่ &ldquo;สมาชิกที่เป็นเจ้าของ&rdquo; ด้านล่าง)</p>
      ) : (
        <>
          <label className="text-sm">หุ้นที่ครอบครัวถือ<input name="shares_owned" inputMode="decimal" data-money="off" defaultValue={dv(v.shares_owned)} className={input} /></label>
          <label className="text-sm">% ที่ถือในบริษัท<input name="company_ownership_percent" inputMode="decimal" defaultValue={dv(v.company_ownership_percent)} className={input} /></label>
        </>
      )}
      <label className="text-sm md:col-span-3">หมายเหตุ<textarea name="notes" rows={2} defaultValue={v.notes ?? ""} className={input} /></label>
      <LogoPicker name={v.name} current={v.logo_data} />
      <div className="flex items-center gap-3 md:col-span-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึกรายละเอียด"}</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- โลโก้บริษัท
   ย่อรูปในเบราว์เซอร์เป็น 128×128 (คงสัดส่วน · พื้นโปร่งใส) → data URL · ส่งไปบันทึกเฉพาะเมื่อเปลี่ยน / ลบ
   ฐานข้อมูลรับ png / jpeg / webp ไม่เกิน 60,000 ตัวอักษร (pbd_logo_data_ck) */
const LOGO_PX = 128;
const LOGO_MAX = 60000;

async function shrinkLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("อ่านรูปไม่ได้")); i.src = url;
    });
    const scale = Math.min(LOGO_PX / img.width, LOGO_PX / img.height, 1);
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    for (const [type, q] of [["image/webp", 0.9], ["image/png", undefined], ["image/webp", 0.7], ["image/jpeg", 0.8]] as const) {
      const d = c.toDataURL(type, q);
      if (d.startsWith(`data:${type};base64,`) && d.length <= LOGO_MAX) return d;
    }
    throw new Error("รูปใหญ่เกินไป — ลองใช้รูปที่เรียบง่ายกว่านี้");
  } finally { URL.revokeObjectURL(url); }
}

function LogoPicker({ name, current }: { name: string; current: string | null }) {
  const [logo, setLogo] = useState<string | null>(current);
  const [err, setErr] = useState("");
  const changed = logo !== current;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm md:col-span-3">
      <span className="text-slate-700">โลโก้บริษัท</span>
      <BusinessBadge logo={logo} name={name} color="#94a3b8" className="h-12 w-14" />
      <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
        {logo ? "เปลี่ยนรูป" : "เลือกรูป"}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (!f) return;
            setErr("");
            try { setLogo(await shrinkLogo(f)); } catch (x) { setErr(x instanceof Error ? x.message : "อ่านรูปไม่ได้"); }
          }} />
      </label>
      {logo && <button type="button" onClick={() => setLogo(null)} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-red-700 hover:bg-red-50">ลบโลโก้</button>}
      {changed && <input type="hidden" name="logo_data" value={logo ?? ""} />}
      <span className="text-xs text-slate-500">{changed ? "ยังไม่บันทึก — กด “บันทึกรายละเอียด”" : "ไม่ใส่ = แสดงตัวย่อสีเหมือนเดิม · ระบบย่อรูปให้เอง"}</span>
      {err && <span className="w-full text-xs text-red-600">{err}</span>}
    </div>
  );
}

type Holder = { person_id: string; name: string; shares: number; cost: number | null };
const n = (v: string) => Number(String(v).replace(/,/g, "")) || 0;
const fx = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 10000) / 10000) : "");
const signed = (v: number, ccy: string) => `${v >= 0 ? "+" : "−"}${money(Math.abs(v), ccy)}`;

/**
 * ขายหุ้นรายคน: เลือกผู้ขายทีละคน · ใส่ราคาต่อหุ้นหรือราคารวม (อีกช่องคำนวณให้)
 *   กำไร / ขาดทุนที่ลงบัญชี = เงินขายสุทธิ − หุ้นที่ขาย × ราคาหุ้นตามการประเมินล่าสุด · เทียบราคาทุน = ดูเป็นข้อมูล
 *   ตัวเลขใต้ฟอร์มคำนวณให้ดูก่อนบันทึก (ฐานข้อมูลคำนวณซ้ำตอนบันทึก)
 */
export function ShareSaleForm({ assetId, currency, banks, holders, familyShares, value, avgCost, today, minDate }: {
  assetId: string; currency: string; banks: Bank[]; holders: Holder[]; familyShares: number; value: number | null;
  avgCost: number | null; today: string; minDate: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(sellShares, {});
  const [who, setWho] = useState(holders[0]?.person_id ?? "");
  const [sh, setSh] = useState("");
  const [unit, setUnit] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const h = holders.find((x) => x.person_id === who);
  const sold = n(sh);
  const over = !!h && sold > h.shares;
  const left = familyShares - sold;
  const list = banks.filter((b) => b.currency === currency);
  const perShare = value != null && familyShares > 0 ? value / familyShares : null;   // ราคาหุ้นตามการประเมิน
  const book = perShare != null ? Math.round(perShare * sold * 100) / 100 : null;
  const net = n(price) - n(fee);
  const gain = book != null ? net - book : null;
  const cps = h?.cost ?? avgCost;
  const costGain = cps != null ? net - cps * sold : null;
  const setShares = (v: string) => { setSh(v); if (n(unit) > 0) setPrice(fx(n(unit) * n(v))); };
  return (
    <Box title="ขายหุ้น" label="ขายหุ้น" action={action} pending={pending} state={state}>
      <input type="hidden" name="asset_id" value={assetId} />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">ผู้ขาย *
          <select name="person_id" required value={who} onChange={(e) => { setWho(e.target.value); setSh(""); }} className={input}>
            {holders.map((x) => <option key={x.person_id} value={x.person_id}>{x.name} · ถืออยู่ {qty(x.shares)} หุ้น</option>)}
          </select>
        </label>
        <label className="text-sm">จำนวนหุ้นที่ขาย *
          <span className="flex gap-2">
            <input name="shares" required inputMode="decimal" data-money="off" value={sh} onChange={(e) => setShares(e.target.value)} className={input} />
            {h && <button type="button" onClick={() => setShares(String(h.shares))} className="mt-1 whitespace-nowrap rounded-md border border-slate-300 px-2 text-xs hover:bg-slate-50">ขายทั้งหมด</button>}
          </span>
        </label>
        <label className="text-sm">วันที่ขาย *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className="text-sm">ราคาขายต่อหุ้น
          <input inputMode="decimal" value={unit} onChange={(e) => { setUnit(e.target.value); if (sold > 0) setPrice(fx(n(e.target.value) * sold)); }} className={input} />
        </label>
        <label className="text-sm">ราคาขายรวม ({currency}) *
          <input name="price" required inputMode="decimal" value={price} onChange={(e) => { setPrice(e.target.value); if (sold > 0) setUnit(fx(n(e.target.value) / sold)); }} className={input} />
        </label>
        <label className="text-sm">ค่าใช้จ่ายในการขาย<input name="fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="ค่าธรรมเนียม / ภาษี" className={input} /></label>
        <label className="text-sm">เงินเข้าบัญชี
          <select name="bank_asset_id" defaultValue={list[0]?.asset_id ?? ""} className={input}>
            <option value="">— ไม่ผ่านบัญชี —</option>
            {list.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
          </select>
        </label>
        <label className="text-sm md:col-span-2">หมายเหตุ<input name="notes" placeholder="ผู้ซื้อ / เลขที่สัญญา" className={input} /></label>
      </div>
      {sold > 0 && (
        <div className={`rounded-lg p-3 text-xs ${over ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-700"}`}>
          {over ? <p>{h?.name} ถืออยู่ {qty(h?.shares)} หุ้น — ขายเกินที่ถือไม่ได้</p> : (
            <ul className="space-y-0.5">
              <li>เงินขายสุทธิ {money(net, currency)}{perShare != null && <> · ราคาหุ้นตามการประเมิน {money(perShare, currency, 4)} → มูลค่าส่วนที่ขาย {money(book, currency)}</>}</li>
              {gain != null && <li className={`font-medium ${gain >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                {gain >= 0 ? "กำไร" : "ขาดทุน"}จากการขาย {money(Math.abs(gain), currency)} → ลงเป็น{gain >= 0 ? "รายได้" : "ค่าใช้จ่าย"}ของ {h?.name}</li>}
              {costGain != null && <li className="text-slate-500">เทียบราคาทุน ({money(cps, currency, 4)}/หุ้น): {signed(costGain, currency)} (ดูเป็นข้อมูล)</li>}
              <li>{h?.name} เหลือ {qty((h?.shares ?? 0) - sold)} หุ้น{(h?.shares ?? 0) - sold <= 0 ? " (ขายหมด · หลุดจากรายชื่อเจ้าของ)" : ""}
                {" · "}หุ้นที่ครอบครัวถือ {qty(familyShares)} → {qty(left)}</li>
              {left <= 0 && <li className="font-medium text-amber-700">ทุกคนขายหมด → ธุรกิจจะเปลี่ยนเป็น &ldquo;ขายหุ้นแล้ว&rdquo;</li>}
            </ul>
          )}
        </div>
      )}
      <p className="text-xs text-slate-500">เงินเข้าบัญชีรวม = เงินขายสุทธิ (ทุนคืน + กำไร) · ขาดทุนไม่มีเงินออกจากบัญชี · โอนหุ้นให้กันในครอบครัวไม่ใช่การขาย ให้แก้จำนวนหุ้นของสมาชิกแทน</p>
    </Box>
  );
}

/** ลงทุนเพิ่ม: ผู้ลงทุน · หุ้นที่ได้ × ราคาต่อหุ้น · บริษัทออกหุ้นใหม่หรือซื้อต่อจากคนนอกครอบครัว */
export function BuySharesForm({ assetId, currency, banks, persons, holders, avgCost, today, minDate }: {
  assetId: string; currency: string; banks: Bank[]; persons: { id: string; name: string }[]; holders: Holder[]; avgCost: number | null; today: string; minDate: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(buyShares, {});
  const [who, setWho] = useState(holders[0]?.person_id ?? persons[0]?.id ?? "");
  const [sh, setSh] = useState("");
  const [unit, setUnit] = useState("");
  const [amount, setAmount] = useState("");
  const list = banks.filter((b) => b.currency === currency);
  const h = holders.find((x) => x.person_id === who);
  const got = n(sh);
  const oldCost = h ? h.cost ?? avgCost : null;
  const newCost = got > 0 && n(amount) > 0 ? (h && oldCost != null ? (h.shares * oldCost + n(amount)) / (h.shares + got) : !h ? n(amount) / got : null) : null;
  return (
    <Box title="ลงทุนเพิ่ม (ได้หุ้นเพิ่ม)" label="+ ลงทุนเพิ่ม" action={action} pending={pending} state={state}>
      <input type="hidden" name="asset_id" value={assetId} />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">ผู้ลงทุน *
          <select name="person_id" required value={who} onChange={(e) => setWho(e.target.value)} className={input}>
            {persons.map((p) => { const x = holders.find((y) => y.person_id === p.id); return <option key={p.id} value={p.id}>{p.name}{x ? ` · ถืออยู่ ${qty(x.shares)} หุ้น` : ""}</option>; })}
          </select>
        </label>
        <label className="text-sm">จำนวนหุ้นที่ได้ *
          <input name="shares" required inputMode="decimal" data-money="off" value={sh}
            onChange={(e) => { setSh(e.target.value); if (n(unit) > 0) setAmount(fx(n(unit) * n(e.target.value))); }} className={input} />
        </label>
        <label className="text-sm">ราคาต่อหุ้น
          <input inputMode="decimal" value={unit} onChange={(e) => { setUnit(e.target.value); if (got > 0) setAmount(fx(n(e.target.value) * got)); }} className={input} />
        </label>
        <label className="text-sm">ยอดจ่าย ({currency}) *
          <input name="amount" required inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); if (got > 0) setUnit(fx(n(e.target.value) / got)); }} className={input} />
        </label>
        <label className="text-sm">วันที่ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className="text-sm">จ่ายจากบัญชี *
          <select name="bank_asset_id" required defaultValue={list[0]?.asset_id ?? ""} className={input}>
            {list.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm md:col-span-3">
          <input type="checkbox" name="new_issue" defaultChecked /> บริษัทออกหุ้นใหม่ (เพิ่มทุน · หุ้นทั้งหมดของบริษัทเพิ่มขึ้น) — ไม่ติ๊ก = ซื้อต่อจากผู้ถือหุ้นนอกครอบครัว
        </label>
        <label className="text-sm md:col-span-3">หมายเหตุ<input name="notes" className={input} /></label>
      </div>
      {newCost != null && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
        ราคาทุนเฉลี่ยของ {persons.find((p) => p.id === who)?.name} หลังลงทุน {money(newCost, currency, 4)}/หุ้น · มูลค่าส่วนของครอบครัว + {money(n(amount), currency)}</p>}
      <p className="text-xs text-slate-500">เงินออกจากบัญชี (ไม่ใช่ค่าใช้จ่าย) · มูลค่ากิจการเพิ่มเท่ายอดจ่าย · ให้กู้กับบริษัทให้บันทึกที่หน้า Loans Receivable</p>
    </Box>
  );
}

/** ยกเลิกการขายหุ้นครั้งล่าสุด (ถามยืนยันก่อน) */
export function UndoShareSale({ assetId, saleId, confirmText }: { assetId: string; saleId: string; confirmText: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(undoShareSale, {});
  const cf = useConfirmSubmit();
  if (state.ok) return <span className="text-xs text-emerald-700">{state.ok}</span>;
  return (
    <form action={action} onSubmit={cf.guard(confirmText, { danger: true, okLabel: "ยืนยันยกเลิกการขาย" })} className="inline-flex flex-col items-end">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="sale_id" value={saleId} />
      <button disabled={pending} className="whitespace-nowrap rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50">
      <BalanceGuard />
        {pending ? "…" : "ยกเลิกการขายนี้"}</button>
      {state.error && <span className="mt-1 max-w-60 text-right text-xs text-red-600">{state.error}</span>}
      {cf.dialog}
    </form>
  );
}
