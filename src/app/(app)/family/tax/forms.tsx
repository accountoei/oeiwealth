"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ModalButton from "@/components/ModalButton";
import { useNavPending } from "@/components/HeaderBar";
import { TAX_FORM_LABEL, TAX_METHOD_LABEL, TAX_SETTLEMENT_LABEL, money } from "@/lib/format";
import { amendReturn, createReturn, deleteReturn, refreshReturn, saveLine, saveSettlement, setStatus, type ActionState } from "./actions";
import Flash from "@/components/Flash";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const primary = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const plain = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50";
type Act = (s: ActionState, f: FormData) => Promise<ActionState>;

function useAct(act: Act) {
  const [state, action, pending] = useActionState<ActionState, FormData>(act, {});
  const router = useRouter();
  useEffect(() => { if (state.ok) router.refresh(); }, [state, router]);
  return { state, action, pending };
}
function Msg({ state }: { state: ActionState }) {
  return <>{state.error && <span className="text-sm text-red-600">{state.error}</span>}<Flash on={state} as="span" className="text-sm text-emerald-700" /></>;
}

/** ปุ่มคำสั่งเดียว (ส่ง id + ค่าซ่อน) */
export function ActButton({ act, id, label, extra, cls = plain }: { act: "refresh" | "status"; id: string; label: string; extra?: Record<string, string>; cls?: string }) {
  const { state, action, pending } = useAct(act === "refresh" ? refreshReturn : setStatus);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button disabled={pending} className={cls}>{pending ? "กำลังทำ…" : label}</button>
      {state.error && <span className="text-sm text-red-600">{state.error}</span>}
    </form>
  );
}

/** สร้างแบบร่างของผู้เสียภาษี / ปีที่เลือก */
export function CreateReturn({ personId, year }: { personId: string; year: number }) {
  const { state, action, pending } = useAct(createReturn);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="person_id" value={personId} />
      <input type="hidden" name="tax_year" value={year} />
      <label className="text-sm">แบบที่ยื่น
        <select name="form_type" defaultValue="PND90" className={input}>
          {Object.entries(TAX_FORM_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <button disabled={pending} className={primary}>{pending ? "กำลังสร้าง…" : "+ สร้างแบบร่าง"}</button>
      <Msg state={state} />
    </form>
  );
}

/** บันทึกว่ายื่นแล้ว (ล็อกยอดที่ยื่น) */
export function FileReturn({ id, today, result }: { id: string; today: string; result: number }) {
  const { state, action, pending } = useAct(setStatus);
  return (
    <ModalButton label="บันทึกว่ายื่นแล้ว" title="บันทึกว่ายื่นแบบแล้ว" primary>
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="status" value="FILED" />
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">วันที่ยื่น *<input name="filed_date" type="date" required defaultValue={today} max={today} className={input} /></label>
          <label className="text-sm">เลขอ้างอิงการยื่น<input name="reference_no" autoComplete="off" className={input} /></label>
          <label className="text-sm">ผลภาษีตามแบบ
            <select name="result_sign" defaultValue={result < 0 ? "refund" : "pay"} className={input}><option value="pay">ชำระเพิ่ม</option><option value="refund">ขอคืน</option></select>
          </label>
          <label className="text-sm">จำนวน (บาท)<input name="tax_result" inputMode="decimal" defaultValue={result ? Math.abs(result).toFixed(2) : ""} className={`${input} text-right`} />
            <span className="mt-1 block text-xs text-slate-500">เติมจากส่วนที่ 5 · แก้ให้ตรงกับแบบที่ยื่นจริง</span></label>
          <label className="text-sm">สถานะการชำระ / คืน
            <select name="settlement_status" defaultValue="" className={input}>
              <option value="">— ยังไม่ระบุ —</option>
              {Object.entries(TAX_SETTLEMENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="text-sm">วันที่ชำระ / ได้รับคืน<input name="settled_date" type="date" className={input} /></label>
        </div>
        <p className="text-xs text-amber-700">บันทึกแล้วยอดทุกรายการจะถูกล็อกตามที่ยื่น · ถ้าต้องแก้ภายหลังให้ใช้ &ldquo;ยื่นเพิ่มเติม&rdquo; (ฉบับเดิมเก็บไว้)</p>
        <div className="flex flex-wrap items-center gap-3"><button disabled={pending} className={primary}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button><Msg state={state} /></div>
      </form>
    </ModalButton>
  );
}

/** ยื่นเพิ่มเติม (ฉบับใหม่) */
export function AmendReturn({ id }: { id: string }) {
  const { state, action, pending } = useAct(amendReturn);
  return (
    <ModalButton label="ยื่นเพิ่มเติม" title="ยื่นแบบเพิ่มเติม">
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <label className="block text-sm">เหตุผลที่ยื่นเพิ่มเติม *<input name="reason" required className={input} placeholder="เช่น ได้หนังสือรับรอง 50 ทวิ เพิ่ม" /></label>
        <p className="text-xs text-slate-500">ระบบสร้างฉบับใหม่ (คัดลอกยอดจากฉบับที่ยื่นแล้ว) ให้แก้ต่อ · ฉบับเดิมยังเก็บไว้ในประวัติ</p>
        <div className="flex flex-wrap items-center gap-3"><button disabled={pending} className={primary}>{pending ? "กำลังสร้าง…" : "สร้างฉบับยื่นเพิ่มเติม"}</button><Msg state={state} /></div>
      </form>
    </ModalButton>
  );
}

/** ลบแบบร่าง */
export function DeleteReturn({ id }: { id: string }) {
  const { state, action, pending } = useAct(deleteReturn);
  return (
    <ModalButton label="ลบแบบร่าง" title="ลบแบบร่าง">
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <p className="text-sm text-slate-700">ลบแบบร่างนี้และยอดที่แก้ไว้ · ไม่กระทบรายได้ / รายจ่ายในระบบ</p>
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={pending} className="rounded-md bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50">{pending ? "กำลังลบ…" : "ลบ"}</button><Msg state={state} />
        </div>
      </form>
    </ModalButton>
  );
}

/** แบบที่ยื่นแล้ว: ผลการชำระ / รับคืน */
export function SettlementForm({ id, v }: { id: string; v: { settlement_status: string | null; settled_date: string | null; notes: string | null } }) {
  const { state, action, pending } = useAct(saveSettlement);
  return (
    <ModalButton label="บันทึกผลชำระ / รับคืน" title="ผลการชำระ / รับคืนภาษี">
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">สถานะ
            <select name="settlement_status" defaultValue={v.settlement_status ?? ""} className={input}>
              <option value="">— ยังไม่ระบุ —</option>
              {Object.entries(TAX_SETTLEMENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="text-sm">วันที่ชำระ / ได้รับคืน<input name="settled_date" type="date" defaultValue={v.settled_date ?? ""} className={input} /></label>
          <label className="text-sm md:col-span-2">หมายเหตุ<input name="notes" defaultValue={v.notes ?? ""} className={input} /></label>
        </div>
        <div className="flex flex-wrap items-center gap-3"><button disabled={pending} className={primary}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button><Msg state={state} /></div>
      </form>
    </ModalButton>
  );
}

export type LineV = {
  id: string; section: string; code: string; label: string; system_amount: number | null; qty: number | null;
  filed_amount: number | null; filed_qty: number | null; method: string | null; reason: string | null;
};
const QTY_CODES = ["PERSONAL", "SPOUSE", "CHILD", "PARENT", "DISABLED"];

/** แก้ยอดใช้ยื่นของรายการ (ว่าง = ใช้ยอดจากระบบ · ต่างจากระบบต้องมีเหตุผล) */
export function LineEditor({ v, children }: { v: LineV; children?: ReactNode }) {
  const { state, action, pending } = useAct(saveLine);
  const hasQty = QTY_CODES.includes(v.code);
  return (
    <ModalButton label="แก้" title={v.label}>
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={v.id} />
        <p className="text-sm text-slate-600">ยอดจากระบบ: <span className="tabular-nums">{v.system_amount == null ? "ไม่มีข้อมูล" : `${money(v.system_amount)} บาท`}</span>
          {hasQty && v.qty != null && <> · จำนวนจากระบบ {v.qty}</>}</p>
        {children}
        <div className="grid gap-3 md:grid-cols-2">
          {v.section === "EXPENSE" && (
            <label className="text-sm">วิธีหักค่าใช้จ่าย
              <select name="method" defaultValue={v.method ?? "FLAT"} className={input}>
                {Object.entries(TAX_METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          )}
          {hasQty && <label className="text-sm">จำนวนที่ใช้สิทธิ (คน)<input name="filed_qty" inputMode="decimal" data-money="off" defaultValue={v.filed_qty ?? ""} placeholder={v.qty == null ? "" : String(v.qty)} className={`${input} text-right`} /></label>}
          <label className="text-sm">{v.section === "EXPENSE" ? "ยอดค่าใช้จ่าย (บาท)" : hasQty ? "ยอดที่ใช้สิทธิ (บาท · ถ้ามี)" : "ยอดใช้ยื่น (บาท)"}
            <input name="filed_amount" inputMode="decimal" defaultValue={v.filed_amount ?? ""} placeholder={v.system_amount == null ? "" : money(v.system_amount)} className={`${input} text-right`} />
          </label>
          <label className="text-sm md:col-span-2">เหตุผล / ที่มา (ต้องใส่ถ้ายอดต่างจากระบบ)<input name="reason" defaultValue={v.reason ?? ""} className={input} placeholder="เช่น ตามหนังสือรับรอง 50 ทวิ" /></label>
        </div>
        <p className="text-xs text-slate-500">เว้นว่าง = ใช้ยอดจากระบบ · ดึงยอดจากระบบใหม่ภายหลังจะไม่ทับยอดที่กรอกเอง</p>
        <div className="flex flex-wrap items-center gap-3"><button disabled={pending} className={primary}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button><Msg state={state} /></div>
      </form>
    </ModalButton>
  );
}

/** ตัวเลือก ผู้เสียภาษี / ปีภาษี (?p= · ?y= ปี ค.ศ.) */
export function TaxFilters({ persons, years, p, y }: { persons: { id: string; name: string }[]; years: number[]; p: string; y: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { start } = useNavPending();
  const go = (k: string, v: string) => {
    const q = new URLSearchParams(sp.toString());
    q.set(k, v);
    start(() => router.replace(`${pathname}?${q}`, { scroll: false }));
  };
  const cls = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {persons.length > 1 && (
        <select aria-label="ผู้เสียภาษี" value={p} onChange={(e) => go("p", e.target.value)} className={cls}>
          {persons.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      )}
      <select aria-label="ปีภาษี" value={y} onChange={(e) => go("y", e.target.value)} className={cls}>
        {years.map((x) => <option key={x} value={x}>ปีภาษี {x + 543}</option>)}
      </select>
    </div>
  );
}
