"use client";

import { useActionState, useEffect, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import BalanceGuard from "@/components/BalanceGuard";
import BankOptions from "@/components/BankOptions";
import Flash from "@/components/Flash";
import { InfoTip } from "@/components/HeaderBar";
import { SMALL_BTN, minusMoney, money, numOrZero as num, plusMoney, thDate } from "@/lib/format";
import { closeLease, closeoutPreview, type ActionState, type CloseoutPreview } from "../actions";
import type { Bank } from "../LeaseFields";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * ปุ่ม "ผู้เช่าออก" (pop up · ตกลง 6 พ.ย. 2026): วันที่ออก → ระบบคิดค่าเช่าถึงวันนั้น (สูตรเดียวกับหน้ารับค่าเช่า)
 *   เงินประกัน − ค่าเช่าค้าง − ค่าน้ำไฟค้าง − ค่าเสียหาย − ริบ = คืนเงินประกัน · + ค่าเช่าที่จ่ายล่วงหน้าเกิน = โอนคืนรวม
 *   บันทึกครั้งเดียวทั้งชุด (ยกเลิกได้ที่ปุ่ม "ยกเลิกผู้เช่าออก") · พิมพ์ใบสรุปได้จากการ์ดสัญญา
 */
export default function CloseLeaseForm({ assetId, leaseId, tenant, startDate, endDate, terminated, today, currency, banks, defaultBank, damage, damageReason }: {
  assetId: string; leaseId: string; tenant: string; startDate: string; endDate: string; terminated: string | null; today: string;
  currency: string; banks: Bank[]; defaultBank?: string | null;
  /** ค่าเสียหายจากรายการส่งมอบ (เติมให้ · แก้ได้) */ damage: number; damageReason: string;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "lg" });
  const [state, action, pending] = useActionState<ActionState, FormData>(closeLease, {});
  const maxOut = endDate < today ? endDate : today;
  const [moveOut, setMoveOut] = useState(terminated ?? maxOut);
  const [settled, setSettled] = useState(today);
  const [pv, setPv] = useState<CloseoutPreview | null>(null);
  const [pvErr, setPvErr] = useState("");
  const [dmg, setDmg] = useState(damage > 0 ? money(damage) : "");
  const [forfeit, setForfeit] = useState("");

  useEffect(() => {
    if (!open || !/^\d{4}-\d{2}-\d{2}$/.test(moveOut)) return;
    let live = true;
    closeoutPreview(leaseId, moveOut).then((r) => {
      if (!live) return;
      if ("error" in r) { setPv(null); setPvErr(r.error); } else { setPv(r); setPvErr(""); }
    });
    return () => { live = false; };
  }, [open, leaseId, moveOut]);

  if (state.ok) return <Flash on={state} as="p" className="text-xs text-emerald-700" />;
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls(SMALL_BTN)}>ผู้เช่าออก / คืนเงินประกัน</button>;
  if (!open) return trigger;

  const dep = Number(pv?.deposit ?? 0);
  const unpaid = Number(pv?.unpaid_rent ?? 0);
  const util = Number(pv?.utilities ?? 0);
  const over = Number(pv?.advance_rent ?? 0);
  const ded = r2(unpaid + util + num(dmg) + num(forfeit));
  const refund = r2(dep - ded);
  const net = r2(Math.max(refund, 0) + over);
  const early = moveOut < endDate;
  const sameCcy = banks.filter((b) => b.currency === currency);
  const unpaidRows = (pv?.rent ?? []).filter((x) => Number(x.unpaid) > 0);
  const overRows = (pv?.rent ?? []).filter((x) => Number(x.over) > 0);
  const cycle = (x: { from: string | null; to: string | null; period: string }) =>
    x.from && x.to ? `${thDate(x.from)} – ${thDate(x.to)}` : `งวด ${thDate(x.period)}`;
  const row = "flex items-baseline justify-between gap-3 py-1";
  const sub = "pl-4 text-xs text-slate-500";

  return present(trigger, (
    <form action={action} className="space-y-4">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="lease_id" value={leaseId} />
      <input type="hidden" name="net_transfer" value={net > 0 ? String(net) : ""} />
      <h3 className="font-medium text-slate-900">ผู้เช่าออก · {tenant} <InfoTip label="คำอธิบาย">ค่าเช่าคิดถึงวันที่ออก (สูตรเดียวกับหน้ารับค่าเช่า · งวดสุดท้ายคิดตามจำนวนวัน) · บันทึกแล้ว: ค่าเช่า / ค่าน้ำไฟที่ค้าง ขึ้น &ldquo;ได้รับแล้ว&rdquo; (หักจากเงินประกัน ไม่ผ่านบัญชี) · ค่าเสียหายและส่วนที่ริบเป็นรายได้อื่น · เงินประกันที่เหลือโอนคืน · ค่าเช่าที่จ่ายล่วงหน้าเกินคืนเป็นค่าใช้จ่ายของทรัพย์สิน &ldquo;คืนค่าเช่าล่วงหน้า&rdquo; · ยกเลิกทั้งชุดได้ที่ปุ่ม &ldquo;ยกเลิกผู้เช่าออก&rdquo; · พิมพ์ใบสรุปได้จากการ์ดสัญญา</InfoTip></h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">วันที่ผู้เช่าออก (วันสุดท้ายที่คิดค่าเช่า)
          <input name="move_out" type="date" required value={moveOut} min={startDate} max={maxOut} readOnly={!!terminated}
            onChange={(e) => { setMoveOut(e.target.value); if (settled < e.target.value) setSettled(e.target.value); }}
            className={`mt-1 block ${input} ${terminated ? "bg-slate-50 text-slate-500" : ""}`} />
        </label>
        <label className="text-sm">วันที่คืนเงิน
          <input name="settled_date" type="date" required value={settled} min={moveOut} max={today} onChange={(e) => setSettled(e.target.value)}
            className={`mt-1 block ${input}`} />
        </label>
      </div>
      <p className="text-xs text-slate-500">
        {terminated ? `สัญญาเลิกไว้แล้ววันที่ ${thDate(terminated)} (ADMIN แก้วันได้ที่ปุ่ม "แก้วันเลิกสัญญา")`
          : early ? `ออกก่อนครบสัญญา (สิ้นสุด ${thDate(endDate)}) → ระบบเลิกสัญญาให้ ณ วันที่ออก`
          : "ออกตามวันสิ้นสุดสัญญา"}
      </p>

      {pvErr && <p className="text-sm text-red-600">{pvErr}</p>}
      {!pv && !pvErr && <p className="text-sm text-slate-500">กำลังคำนวณ…</p>}
      {pv && (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 px-4 py-2 text-sm">
          <div className={row}><span>เงินประกันที่ถืออยู่</span><span className="tabular-nums">{money(dep, currency)}</span></div>
          <div className="py-1">
            <div className={row}><span>หัก ค่าเช่าค้างถึงวันที่ออก</span><span className={`tabular-nums ${unpaid > 0 ? "text-red-600" : ""}`}>{minusMoney(unpaid)}</span></div>
            {unpaidRows.map((x) => (
              <div key={x.period} className={sub}>{cycle(x)} · ควรได้ {money(x.expected)} · รับแล้ว {money(x.received)}</div>
            ))}
          </div>
          {pv.charges.length > 0 && (
            <div className="py-1">
              <div className={row}><span>หัก ค่าน้ำไฟเรียกเก็บที่ยังไม่ได้รับ</span><span className="tabular-nums text-red-600">{minusMoney(util)}</span></div>
              {pv.charges.map((c) => <div key={c.id} className={sub}>{c.description} · {money(c.amount)}</div>)}
            </div>
          )}
          <div className="grid gap-2 py-2 md:grid-cols-[8rem_1fr]">
            <label className="text-xs">หัก ค่าเสียหาย
              <input name="damage" inputMode="decimal" value={dmg} onChange={(e) => setDmg(e.target.value)} placeholder="0.00"
                className={`mt-1 block w-full ${input}`} />
            </label>
            <label className="text-xs">รายการค่าเสียหาย{num(dmg) > 0 ? " (จำเป็น)" : ""}
              <input name="damage_reason" required={num(dmg) > 0} defaultValue={damageReason} placeholder="เช่น ผนังเป็นรอย · กุญแจหาย"
                className={`mt-1 block w-full ${input}`} />
            </label>
            <label className="text-xs">หัก ริบเงินประกัน
              <input name="forfeit" inputMode="decimal" value={forfeit} onChange={(e) => setForfeit(e.target.value)} placeholder="0.00"
                className={`mt-1 block w-full ${input}`} />
            </label>
            <label className="text-xs">เหตุผลที่ริบ{num(forfeit) > 0 ? " (จำเป็น)" : ""}
              <input name="forfeit_reason" required={num(forfeit) > 0} defaultValue={early ? "ออกก่อนครบสัญญา" : ""} placeholder="เช่น ออกก่อนครบสัญญา / ไม่แจ้งล่วงหน้า"
                className={`mt-1 block w-full ${input}`} />
            </label>
          </div>
          <div className={`${row} font-medium`}><span>คืนเงินประกัน</span>
            <span className={`tabular-nums ${refund < 0 ? "text-red-600" : ""}`}>{money(refund, currency)}</span></div>
          <div className="py-1">
            <div className={row}><span>บวก ค่าเช่าที่จ่ายล่วงหน้าเกินวันที่อยู่จริง</span><span className="tabular-nums">{plusMoney(over)}</span></div>
            {overRows.map((x) => (
              <div key={x.period} className={sub}>{cycle(x)} · รับแล้ว {money(x.received)} · คิดถึงวันที่ออก {money(x.expected)}</div>
            ))}
          </div>
          <div className={`${row} text-base font-semibold`}><span>โอนคืนผู้เช่ารวม</span><span className="tabular-nums">{money(refund < 0 ? 0 : net, currency)}</span></div>
        </div>
      )}
      {refund < 0 && (
        <p className="text-sm text-red-600">ยอดหักเกินเงินประกัน {money(-refund, currency)} — รับค่าเช่า / ค่าน้ำไฟที่ค้างจากผู้เช่าก่อน (แท็บรับค่าเช่า) หรือลดยอดหัก</p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {net > 0 && refund >= 0 && (
          <label className="text-sm">โอนคืนจากบัญชี
            <select name="bank_asset_id" required defaultValue={sameCcy.find((b) => b.asset_id === defaultBank)?.asset_id ?? sameCcy[0]?.asset_id ?? ""}
              className={`mt-1 block ${input}`}>
              <option value="">— เลือกบัญชี —</option>
              <BankOptions banks={sameCcy} />
            </select>
          </label>
        )}
        <label className="min-w-48 flex-1 text-sm">หมายเหตุ
          <input name="notes" className={`mt-1 block w-full ${input}`} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending || !pv || refund < 0} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกผู้เช่าออก"}</button>
        <BalanceGuard bank="bank_asset_id" amount="net_transfer" date="settled_date" />
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  ));
}
