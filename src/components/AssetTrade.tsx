"use client";

import { useActionState, useState } from "react";
import { payForAsset, sellAsset, type TradeState } from "@/lib/asset-trade";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
type Bank = { asset_id: string; name: string; currency: string };

function Box({ title, label, children, action, pending, state, danger }: {
  title: string; label: string; children: React.ReactNode; action: (f: FormData) => void; pending: boolean; state: TradeState; danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!open) return (
    <button type="button" onClick={() => setOpen(true)}
      className={`rounded-md border bg-white px-4 py-2 text-sm hover:bg-slate-50 ${danger ? "border-amber-300 text-amber-800" : "border-slate-300"}`}>{label}</button>
  );
  return (
    <form action={action} className="w-full space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="font-medium text-slate-900">{title}</h3>
      {children}
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  );
}

export function SellAssetForm({ assetId, currency, banks, today, minDate, paths, hasLease }: {
  assetId: string; currency: string; banks: Bank[]; today: string; minDate: string; paths: string[]; hasLease?: boolean;
}) {
  const [state, action, pending] = useActionState<TradeState, FormData>(sellAsset, {});
  const list = banks.filter((b) => b.currency === currency);
  return (
    <Box title="บันทึกการขาย" label="ขายทรัพย์สินนี้" action={action} pending={pending} state={state} danger>
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="paths" value={paths.join(",")} />
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
        <li>เงินเข้าบัญชี = ราคาขาย − ค่าใช้จ่าย (เป็นเงินขายทรัพย์สิน ไม่ใช่รายได้ประจำ)</li>
        <li>บันทึกมูลค่า ณ วันขาย = ราคาขาย แล้วเปลี่ยนสถานะเป็น &ldquo;ขายแล้ว&rdquo; (ไม่นับใน Net Worth หลังวันขาย)</li>
        {hasLease && <li className="text-amber-700">ถ้ายังมีสัญญาเช่าที่มีผลหลังวันขาย ต้องบันทึกเลิกสัญญา / คืนเงินประกันก่อน</li>}
      </ul>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" /> ยืนยันว่าขายแล้วจริง</label>
    </Box>
  );
}

export function PayAssetForm({ assetId, currency, banks, today, minDate, paths, label = "+ จ่ายซื้อ / จ่ายเพิ่ม" }: {
  assetId: string; currency: string; banks: Bank[]; today: string; minDate: string; paths: string[]; label?: string;
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
        <label className="text-sm md:col-span-4">รายละเอียด<input name="description" placeholder="เช่น ผ่อนดาวน์งวด 3 / ต่อเติมห้องครัว" className={input} /></label>
      </div>
      {list.length === 0 && <p className="text-xs text-amber-700">ไม่มีบัญชีสกุล {currency} ที่ใช้งานอยู่</p>}
      <p className="text-xs text-slate-500">เงินออกจากบัญชีไปเป็นทรัพย์สิน (ไม่ใช่ค่าใช้จ่าย) · มูลค่าทรัพย์สินไม่เปลี่ยนเอง ให้อัปเดตมูลค่าหลังบันทึก</p>
    </Box>
  );
}
