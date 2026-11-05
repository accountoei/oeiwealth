"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { diffText, money, thDate } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import Flash from "@/components/Flash";
import { batchCashValues, syncAllCashValues, type ActionState } from "./actions";
import { BatchSave, STICKY_BAR } from "@/components/BatchSave";

export type CvRow = {
  policyId: string; assetId: string | null; name: string; person: string | null; currency: string;
  value: number | null; date: string | null;
  /** ปีล่าสุดในตารางตามสัญญาที่ถึงวันแล้ว */ due: { year: number; value: number; date: string } | null;
  /** ปีในตารางที่ถึงวันแล้วแต่ยังไม่ได้ลง */ pending: boolean;
  /** เบี้ยก่อนวันครบปีนั้นยังค้าง (ระบบยังไม่ลงให้) */ premiumDue: boolean;
  /** อัตราเป็นบาท × สัดส่วนของสมาชิกที่เลือก → ยอดรวมท้ายตาราง */ factor: number;
};
type Entry = { value: string; date: string; fromTable: boolean };

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const n = (s: string) => Number(s.replace(/,/g, ""));
const CV_NOTE = (y: number) => `ตามตารางมูลค่าเวนคืนในสัญญา · สิ้นปีกรมธรรม์ที่ ${y}`;

/**
 * แท็บ อัปเดตมูลค่าเวนคืน (ตกลง 2 พ.ย. 2026 · คล้ายแท็บอัปเดตมูลค่าของ Property)
 *   ทุกกรมธรรม์ที่มีมูลค่าเวนคืนในตารางเดียว · ปีที่ถึงวันแล้วแต่ยังไม่ได้ลง = กรอกค่าตามสัญญาไว้ให้ (สีเหลือง) · กรอกเฉพาะแถวที่เปลี่ยน
 *   ระบบลงตามตารางให้เองทุกเช้าด้วย (เมื่อจ่ายเบี้ยก่อนหน้าครบ) · ยังไม่มีมูลค่าเวนคืน → ปุ่ม "ลงตามสัญญา" สร้างให้ (ADMIN / EDITOR)
 */
export default function CashValueBatch({ rows, today, minDate, canWrite, canCreate, shareNote }: {
  rows: CvRow[]; today: string; minDate: string; canWrite: boolean; canCreate: boolean; shareNote: string | null;
}) {
  const router = useRouter();
  const cf = useConfirmSubmit();
  const initial = () => Object.fromEntries(rows.filter((r) => r.assetId && r.pending && r.due)
    .map((r) => [r.policyId, { value: r.due!.value.toFixed(2), date: r.due!.date, fromTable: true }])) as Record<string, Entry>;
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState("STATEMENT");
  const [ent, setEnt] = useState<Record<string, Entry>>(initial);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, form) => {
    const r = await batchCashValues(prev, form);
    if (r.ok) { setEnt({}); router.refresh(); }
    return r;
  }, {});
  const [sState, syncAction, syncing] = useActionState<ActionState, FormData>(async (prev, form) => {
    const r = await syncAllCashValues(prev, form);
    if (r.ok) router.refresh();
    return r;
  }, {});

  const chosen = rows.filter((r) => r.assetId && (ent[r.policyId]?.value ?? "").trim() !== "");
  const dateOf = (r: CvRow) => ent[r.policyId]?.date || date;
  const isTable = (r: CvRow) => {
    const e = ent[r.policyId];
    return !!(e?.fromTable && r.due && n(e.value) === r.due.value && dateOf(r) === r.due.date);
  };
  const payload = chosen.map((r) => ({
    asset_id: r.assetId, policy_id: r.policyId, label: r.name, value: ent[r.policyId].value, date: dateOf(r),
    method: isTable(r) ? "STATEMENT" : method, notes: isTable(r) ? CV_NOTE(r.due!.year) : null,
  }));
  // ลงตามสัญญาให้ระบบทำ (รวมกรมธรรม์ที่ยังไม่มีมูลค่าเวนคืน): ถึงวันแล้ว + เบี้ยก่อนหน้าครบ
  const syncable = rows.filter((r) => r.pending && !r.premiumDue && (r.assetId || canCreate));
  const set = (r: CvRow, patch: Partial<Entry>) =>
    setEnt({ ...ent, [r.policyId]: { value: ent[r.policyId]?.value ?? "", date: ent[r.policyId]?.date ?? "", fromTable: ent[r.policyId]?.fromTable ?? false, ...patch } });
  const onSubmit = cf.guard(`บันทึกมูลค่าเวนคืนใหม่ ${chosen.length} รายการ?\n${chosen.map((r) => `• ${r.name} ${ent[r.policyId].value} ณ ${thDate(dateOf(r))}`).join("\n")}`,
    { okLabel: "ยืนยันบันทึก" });
  const total = rows.reduce((t, r) => t + Number(r.value ?? 0) * r.factor, 0);
  const pendingCount = rows.filter((r) => r.pending).length;

  return (
    <>
    {cf.dialog}
    <div className="space-y-3">
      <div className={`space-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm ${STICKY_BAR}`}>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">วิธี (แถวที่กรอกเอง)
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={small}>
              <option value="STATEMENT">ตามหนังสือแจ้งจากบริษัทประกัน</option>
              <option value="USER_ESTIMATE">ประมาณเอง</option>
            </select></label>
          {canWrite && syncable.length > 0 && (
            <form action={syncAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="policy_ids" value={JSON.stringify(syncable.map((r) => r.policyId))} />
              <button disabled={syncing} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {syncing ? "กำลังลง…" : `ลงตามสัญญาให้ระบบทำ (${syncable.length} กรมธรรม์)`}</button>
              {sState.error && <span className="text-sm text-red-600">{sState.error}</span>}
              <Flash on={sState} as="span" className="text-sm text-emerald-700" />
            </form>
          )}
          <BatchSave canWrite={canWrite} action={action} onSubmit={onSubmit} fields={{ rows: JSON.stringify(payload) }}
            count={chosen.length} pending={pending} onClear={() => setEnt({})} state={state}
            date={date} onDate={setDate} minDate={minDate} maxDate={today}
            info={<>กรอกเฉพาะกรมธรรม์ที่มูลค่าเปลี่ยน (ช่องว่าง = ไม่บันทึก) · แถวสีเหลือง = ถึงวันครบปีตามตารางในสัญญาแล้วแต่ยังไม่ได้ลง (กรอกค่าตามสัญญาไว้ให้ · แก้ได้)
          · ระบบลงตามตารางให้เองทุกเช้า เมื่อจ่ายเบี้ยก่อนหน้าครบ{shareNote && ` · ${shareNote}`}</>} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="min-w-[12rem] px-3 py-2">กรมธรรม์</th>
              <th className="w-40 px-3 text-right">มูลค่าปัจจุบัน</th>
              <th className="w-48 px-3 text-right">ตามตารางในสัญญา</th>
              <th className="w-40 px-3 text-right">มูลค่าใหม่</th>
              <th className="w-40 px-3">ณ วันที่</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">ไม่มีกรมธรรม์ที่มีมูลค่าเวนคืน</td></tr>}
            {rows.map((r) => {
              const e = ent[r.policyId];
              const filled = (e?.value ?? "").trim() !== "";
              return (
                <tr key={r.policyId} className={`align-top ${r.pending ? "bg-amber-50/50" : filled ? "bg-blue-50/40" : ""}`}>
                  <td className="px-3 py-2">
                    <Link href={`/insurance/${r.policyId}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                    <div className="text-xs text-slate-500">{[r.person, r.currency].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {r.value == null ? "-" : money(r.value, r.currency, 0)}
                    <div className="text-xs text-slate-400">{r.date ? thDate(r.date) : r.assetId ? "ยังไม่มีมูลค่า" : "ยังไม่มีมูลค่าเวนคืน"}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {r.due ? <>
                      {canWrite && r.assetId ? (
                        <button type="button" onClick={() => set(r, { value: r.due!.value.toFixed(2), date: r.due!.date, fromTable: true })}
                          className="tabular-nums text-blue-700 hover:underline" title="ใช้ค่าตามสัญญา">{money(r.due.value, r.currency, 0)}</button>
                      ) : money(r.due.value, r.currency, 0)}
                      <div className="text-xs text-slate-500">ปีที่ {r.due.year} · {thDate(r.due.date)}</div>
                      {r.pending && <div className="text-xs text-amber-700">ยังไม่ได้ลง{r.premiumDue && " · เบี้ยก่อนหน้ายังค้าง"}</div>}
                    </> : <span className="text-xs text-slate-400">ไม่มีตาราง / ยังไม่ถึงปีแรก</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.assetId ? <>
                      <input inputMode="decimal" value={e?.value ?? ""} disabled={!canWrite} placeholder={r.currency} aria-label={`มูลค่าใหม่ ${r.name}`}
                        onChange={(x) => set(r, { value: x.target.value })} className={`w-36 text-right ${small}`} />
                      {filled && r.value != null && !Number.isNaN(n(e!.value)) && (
                        <div className={`text-xs tabular-nums ${n(e!.value) >= r.value ? "text-emerald-700" : "text-red-700"}`}>{diffText(n(e!.value) - r.value, r.value)}</div>
                      )}
                      {filled && isTable(r) && <div className="text-xs text-slate-400">ตามสัญญา</div>}
                    </> : <span className="text-xs text-slate-500">{r.pending && canCreate ? "สร้างด้วยปุ่ม \"ลงตามสัญญา\" ด้านล่าง" : "เพิ่มที่หน้ากรมธรรม์"}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {r.assetId && filled && (
                      <input type="date" value={dateOf(r)} min={minDate || undefined} max={today} aria-label={`วันที่ ${r.name}`}
                        onChange={(x) => x.target.value && set(r, { date: x.target.value })} className={small} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
              <tr>
                <td className="px-3 py-2">รวม (THB){pendingCount > 0 && <span className="ml-2 text-xs font-normal text-amber-700">ยังไม่ได้ลงตามสัญญา {pendingCount} กรมธรรม์</span>}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(total, "THB", 0)}</td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

    </div>
    </>
  );
}
