"use client";

import { useActionState, useEffect, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import BalanceGuard from "@/components/BalanceGuard";
import BankOptions from "@/components/BankOptions";
import Flash from "@/components/Flash";
import { InfoTip } from "@/components/HeaderBar";
import { SMALL_BTN, minusMoney, money, numOrZero as num, plusMoney, thDate } from "@/lib/format";
import { closeLease, closeoutPreview, terminateLease, type ActionState, type CloseoutPreview } from "../actions";
import type { Bank } from "../LeaseFields";
import { MoveOutCheck, checkDamage, type HandoverItem } from "../Inventory";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const r2 = (v: number) => Math.round(v * 100) / 100;
const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

/**
 * ปุ่ม "ผู้เช่าออก" (pop up · ตกลง 6 พ.ย. 2026): วันที่ออก → ระบบคิดค่าเช่าถึงวันนั้น (สูตรเดียวกับหน้ารับค่าเช่า)
 *   เงินประกัน − ค่าเช่าค้าง − ค่าน้ำไฟค้าง − ค่าเสียหาย − ริบ = คืนเงินประกัน · + ค่าเช่าที่จ่ายล่วงหน้าเกิน = โอนคืนรวม
 *   หักเกินเงินประกัน (ลำดับ ค่าเช่า → ค่าน้ำไฟ → ค่าเสียหาย · ริบได้ไม่เกินที่เหลือ): หักกับค่าเช่าล่วงหน้าก่อน
 *     ที่เหลือ = ผู้เช่าต้องจ่ายเพิ่ม → รับเงินแล้ว (เข้าบัญชี) / ยังไม่ได้รับ (ค่าเสียหายค้างรับในแท็บรับค่าเช่า)
 *   ตรวจของตอนส่งคืน (ตกลง 6 พ.ย. 2026): ตารางจากรายการส่งมอบ · ผลตรวจตั้งต้น "ครบ / ปกติ" → ยอดรวม = "หัก ค่าเสียหาย"
 *     บันทึกผลตรวจ (lease_handover_items) ก่อน แล้วจึงบันทึกผู้เช่าออก · ยกเลิกผู้เช่าออกแล้วผลตรวจยังอยู่
 *   ติ๊ก "คืนเงินทีหลัง" = บันทึกวันออกอย่างเดียว (แทนปุ่มเลิกสัญญาก่อนกำหนดเดิม · วันในอนาคตได้)
 *     → สัญญาเลิก ณ วันนั้น ค่าเช่าหยุด เงินประกันขึ้น "รอคืน" · เปิดอีกครั้งเมื่อพร้อมคืนเงิน (วันออกล็อกไว้)
 *   บันทึกครั้งเดียวทั้งชุด (ยกเลิกได้ที่ปุ่ม "ยกเลิกผู้เช่าออก") · พิมพ์ใบสรุปได้จากการ์ดสัญญา
 */
export default function CloseLeaseForm({ assetId, leaseId, tenant, startDate, endDate, terminated, today, currency, banks, defaultBank, items }: {
  assetId: string; leaseId: string; tenant: string; startDate: string; endDate: string; terminated: string | null; today: string;
  currency: string; banks: Bank[]; defaultBank?: string | null;
  /** รายการส่งมอบของสัญญา → ตารางตรวจของตอนส่งคืน */ items: HandoverItem[];
}) {
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "lg" });
  const [state, action, pending] = useActionState<ActionState, FormData>(closeLease, {});
  const [termState, termAction, termPending] = useActionState<ActionState, FormData>(terminateLease, {});
  const maxOut = endDate < today ? endDate : today;
  // คืนเงินทีหลัง: เฉพาะสัญญาที่ยังไม่เลิกและยังไม่ถึงวันสิ้นสุด (ออกตามกำหนด = ไม่ต้องบันทึกวันออก)
  const canLater = !terminated && endDate > today;
  const lastDay = dayBefore(endDate);
  const [later, setLater] = useState(false);
  const [moveOut, setMoveOut] = useState(terminated ?? maxOut);
  const [settled, setSettled] = useState(today);
  const [pv, setPv] = useState<CloseoutPreview | null>(null);
  const [pvErr, setPvErr] = useState("");
  const initChecks = () => items.map((r) => ({ ...r, out_status: r.out_status || "OK" }));
  const [checks, setChecks] = useState<HandoverItem[]>(initChecks);
  const [forfeit, setForfeit] = useState("");
  const [collect, setCollect] = useState<"LATER" | "NOW">("LATER");

  useEffect(() => {
    if (!open || later || !/^\d{4}-\d{2}-\d{2}$/.test(moveOut)) return;
    let live = true;
    closeoutPreview(leaseId, moveOut).then((r) => {
      if (!live) return;
      if ("error" in r) { setPv(null); setPvErr(r.error); } else { setPv(r); setPvErr(""); }
    });
    return () => { live = false; };
  }, [open, later, leaseId, moveOut]);

  if (state.ok) return <Flash on={state} as="p" className="text-xs text-emerald-700" />;
  if (termState.ok) return <Flash on={termState} as="p" className="text-xs text-emerald-700" />;
  // เปิดหน้าต่างใหม่ = ดึงรายการส่งมอบล่าสุด (อาจแก้ที่ปุ่ม "รายการส่งมอบ" หลังโหลดหน้า)
  const trigger = <button onClick={() => { if (!open) setChecks(initChecks()); setOpen(!open); }} className={activeCls(SMALL_BTN)}>ผู้เช่าออก / คืนเงินประกัน</button>;
  if (!open) return trigger;

  const toggleLater = (on: boolean) => {
    setLater(on);
    // คืนเงินทีหลัง: วันในอนาคตได้ (ไม่เกินวันก่อนวันสิ้นสุด) · ไม่ติ๊ก: ไม่เกินวันนี้
    if (on && moveOut > lastDay) setMoveOut(lastDay);
    if (!on && moveOut > maxOut) setMoveOut(maxOut);
  };

  const dep = Number(pv?.deposit ?? 0);
  const unpaid = Number(pv?.unpaid_rent ?? 0);
  const util = Number(pv?.utilities ?? 0);
  const over = Number(pv?.advance_rent ?? 0);
  const dmgInfo = checkDamage(checks);
  const dmgN = dmgInfo.amount;
  const room = r2(Math.max(dep - unpaid - util - dmgN, 0));
  const forfeitErr = num(forfeit) > room + 0.005;
  const ded = r2(unpaid + util + dmgN + num(forfeit));
  const refund = r2(Math.max(dep - ded, 0));
  const short = r2(Math.max(ded - dep, 0));                    // หักเกินเงินประกัน
  const netted = r2(Math.min(over, short));                    // หักกับค่าเช่าล่วงหน้าที่ต้องคืน
  const owe = r2(short - netted);                              // ผู้เช่าต้องจ่ายเพิ่ม
  // ค้างรับได้เฉพาะค่าเสียหาย · ค่าเช่า / ค่าน้ำไฟที่เกินเงินประกันต้องรับเงิน
  const laterOk = owe <= Math.min(dmgN, short) + 0.005;
  const mode = owe > 0 && !laterOk ? "NOW" : collect;
  const cash = mode === "NOW" ? short : netted;
  const netOut = r2(Math.max(refund + over - cash, 0));
  const tenantIn = r2(Math.max(cash - refund - over, 0));
  const needBank = refund + over + cash > 0;
  const early = moveOut < endDate;
  const sameCcy = banks.filter((b) => b.currency === currency);
  const unpaidRows = (pv?.rent ?? []).filter((x) => Number(x.unpaid) > 0);
  const overRows = (pv?.rent ?? []).filter((x) => Number(x.over) > 0);
  const cycle = (x: { from: string | null; to: string | null; period: string }) =>
    x.from && x.to ? `${thDate(x.from)} – ${thDate(x.to)}` : `งวด ${thDate(x.period)}`;
  const row = "flex items-baseline justify-between gap-3 py-1";
  const sub = "pl-4 text-xs text-slate-500";
  const radio = "flex items-start gap-2 text-sm";

  return present(trigger, (
    <form action={action} className="space-y-4">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="lease_id" value={leaseId} />
      <input type="hidden" name="net_transfer" value={netOut > 0 ? String(netOut) : ""} />
      <input type="hidden" name="collect" value={mode} />
      {!later && <>
        <input type="hidden" name="handover_rows" value={JSON.stringify(checks.filter((r) => r.id || r.name.trim() || num(r.deduction) > 0))} />
        <input type="hidden" name="damage" value={dmgN > 0 ? String(dmgN) : ""} />
        <input type="hidden" name="damage_reason" value={dmgInfo.reason} />
      </>}
      {later && <input type="hidden" name="terminated_date" value={moveOut} />}
      <h3 className="font-medium text-slate-900">ผู้เช่าออก · {tenant} <InfoTip label="คำอธิบาย">ค่าเช่าคิดถึงวันที่ออก (สูตรเดียวกับหน้ารับค่าเช่า · งวดสุดท้ายคิดตามจำนวนวัน) · บันทึกแล้ว: ค่าเช่า / ค่าน้ำไฟที่ค้าง ขึ้น &ldquo;ได้รับแล้ว&rdquo; (หักจากเงินประกัน ไม่ผ่านบัญชี) · ค่าเสียหายและส่วนที่ริบเป็นรายได้อื่น · เงินประกันที่เหลือโอนคืน · ค่าเช่าที่จ่ายล่วงหน้าเกินคืนเป็นค่าใช้จ่ายของทรัพย์สิน &ldquo;คืนค่าเช่าล่วงหน้า&rdquo;
        · หักเกินเงินประกัน: หักตามลำดับ ค่าเช่า → ค่าน้ำไฟ → ค่าเสียหาย แล้วหักกับค่าเช่าล่วงหน้าที่ต้องคืน ที่เหลือผู้เช่าจ่ายเพิ่ม (รับแล้ว = รายได้เข้าบัญชี · ยังไม่ได้รับ = ค่าเสียหายค้างรับในแท็บรับค่าเช่า)
        · ยกเลิกทั้งชุดได้ที่ปุ่ม &ldquo;ยกเลิกผู้เช่าออก&rdquo; · พิมพ์ใบสรุปได้จากการ์ดสัญญา</InfoTip></h3>
      {canLater && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={later} onChange={(e) => toggleLater(e.target.checked)} className="mt-0.5" />
          <span>คืนเงินทีหลัง <span className="text-xs text-slate-500">— บันทึกวันออกไว้ก่อน (วันในอนาคตได้) · คืนเงินประกันภายหลังด้วยปุ่มนี้</span></span>
        </label>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">วันที่ผู้เช่าออก (วันสุดท้ายที่คิดค่าเช่า)
          <input name="move_out" type="date" required value={moveOut} min={startDate} max={later ? lastDay : maxOut} readOnly={!!terminated}
            onChange={(e) => { setMoveOut(e.target.value); if (settled < e.target.value) setSettled(e.target.value); }}
            className={`mt-1 block ${input} ${terminated ? "bg-slate-50 text-slate-500" : ""}`} />
        </label>
        {!later && (
          <label className="text-sm">{short > 0 ? "วันที่คืน / รับเงิน" : "วันที่คืนเงิน"}
            <input name="settled_date" type="date" required value={settled} min={moveOut} max={today} onChange={(e) => setSettled(e.target.value)}
              className={`mt-1 block ${input}`} />
          </label>
        )}
      </div>
      <p className="text-xs text-slate-500">
        {later ? `สัญญาเลิก ณ วันที่ออก (สิ้นสุดเดิม ${thDate(endDate)}) · ค่าเช่าคิดถึงวันนั้น · เงินประกันขึ้น "รอคืน" (คืนภายใน 30 วันตามสัญญา)`
          : terminated ? `สัญญาเลิกไว้แล้ววันที่ ${thDate(terminated)} (ADMIN แก้วันได้ที่ปุ่ม "แก้วันเลิกสัญญา")`
          : early ? `ออกก่อนครบสัญญา (สิ้นสุด ${thDate(endDate)}) → ระบบเลิกสัญญาให้ ณ วันที่ออก`
          : "ออกตามวันสิ้นสุดสัญญา"}
      </p>

      {later ? (
        <div className="flex flex-wrap items-center gap-3">
          <button formAction={termAction} formNoValidate disabled={termPending || !moveOut} className={btn}>{termPending ? "กำลังบันทึก…" : "บันทึกวันออก"}</button>
          {termState.error && <span className="text-sm text-red-600">{termState.error}</span>}
        </div>
      ) : <>
        <MoveOutCheck rows={checks} setRows={setChecks} currency={currency} />
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
            <div className="py-1">
              <div className={row}><span>หัก ค่าเสียหาย (จากตารางตรวจของ)</span><span className={`tabular-nums ${dmgN > 0 ? "text-red-600" : ""}`}>{minusMoney(dmgN)}</span></div>
              {dmgInfo.reason && <div className={sub}>{dmgInfo.reason}</div>}
            </div>
            <div className="grid gap-2 py-2 md:grid-cols-[8rem_1fr]">
              <label className="text-xs">หัก ริบเงินประกัน
                <input name="forfeit" inputMode="decimal" value={forfeit} onChange={(e) => setForfeit(e.target.value)} placeholder="0.00"
                  className={`mt-1 block w-full ${input} ${forfeitErr ? "border-red-400" : ""}`} />
              </label>
              <label className="text-xs">เหตุผลที่ริบ{num(forfeit) > 0 ? " (จำเป็น)" : ""}
                <input name="forfeit_reason" required={num(forfeit) > 0} defaultValue={early ? "ออกก่อนครบสัญญา" : ""} placeholder="เช่น ออกก่อนครบสัญญา / ไม่แจ้งล่วงหน้า"
                  className={`mt-1 block w-full ${input}`} />
              </label>
              {forfeitErr && <p className="text-xs text-red-600 md:col-span-2">ริบได้ไม่เกิน {money(room, currency)} (เงินประกันที่เหลือหลังหักค่าเช่า ค่าน้ำไฟ และค่าเสียหาย)</p>}
            </div>
            <div className={`${row} font-medium`}><span>คืนเงินประกัน</span><span className="tabular-nums">{money(refund, currency)}</span></div>
            {short > 0 && (
              <div className={row}><span>หักเกินเงินประกัน</span><span className="tabular-nums text-red-600">{minusMoney(short)}</span></div>
            )}
            <div className="py-1">
              <div className={row}><span>{short > 0 ? "ค่าเช่าที่จ่ายล่วงหน้าเกินวันที่อยู่จริง (หักกับส่วนที่เกิน)" : "บวก ค่าเช่าที่จ่ายล่วงหน้าเกินวันที่อยู่จริง"}</span>
                <span className="tabular-nums">{plusMoney(over)}</span></div>
              {overRows.map((x) => (
                <div key={x.period} className={sub}>{cycle(x)} · รับแล้ว {money(x.received)} · คิดถึงวันที่ออก {money(x.expected)}</div>
              ))}
            </div>
            {owe > 0 ? (
              <div className={`${row} text-base font-semibold`}><span>ผู้เช่าต้องจ่ายเพิ่ม</span><span className="tabular-nums text-red-600">{money(owe, currency)}</span></div>
            ) : (
              <div className={`${row} text-base font-semibold`}><span>โอนคืนผู้เช่ารวม</span><span className="tabular-nums">{money(netOut, currency)}</span></div>
            )}
          </div>
        )}

        {pv && owe > 0 && (
          <fieldset className="space-y-2 rounded-lg border border-slate-200 px-4 py-3">
            <legend className="px-1 text-xs text-slate-500">ผู้เช่าจ่ายเพิ่ม {money(owe, currency)}</legend>
            <label className={`${radio} ${laterOk ? "" : "text-slate-400"}`}>
              <input type="radio" name="collect_choice" checked={mode === "LATER"} disabled={!laterOk} onChange={() => setCollect("LATER")} className="mt-0.5" />
              <span>ยังไม่ได้รับ <span className="text-xs text-slate-500">— ค่าเสียหายส่วนนี้ขึ้น &ldquo;รอรับ&rdquo; ในแท็บรับค่าเช่า บันทึกรับเมื่อผู้เช่าจ่าย
                {!laterOk && " (ค่าเช่า / ค่าน้ำไฟที่ค้างเกินเงินประกัน ต้องรับเงิน หรือรับแยกก่อนในแท็บรับค่าเช่า)"}</span></span>
            </label>
            <label className={radio}>
              <input type="radio" name="collect_choice" checked={mode === "NOW"} onChange={() => setCollect("NOW")} className="mt-0.5" />
              <span>รับเงินแล้ว <span className="text-xs text-slate-500">— เข้าบัญชีที่เลือกด้านล่าง ณ วันที่คืน / รับเงิน</span></span>
            </label>
          </fieldset>
        )}

        <div className="flex flex-wrap items-end gap-3">
          {pv && needBank && (
            <label className="text-sm">{netOut > 0 ? "โอนคืนจากบัญชี" : tenantIn > 0 ? "รับเงินเข้าบัญชี" : "บัญชี (หักกลบค่าเช่าล่วงหน้า)"}
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
          <button disabled={pending || !pv || forfeitErr || dmgInfo.unnamed} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกผู้เช่าออก"}</button>
          {dmgInfo.unnamed && <span className="text-sm text-red-600">ใส่ชื่อรายการของแถวที่มีค่าเสียหาย</span>}
          <BalanceGuard bank="bank_asset_id" amount="net_transfer" date="settled_date" />
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        </div>
      </>}
    </form>
  ));
}
