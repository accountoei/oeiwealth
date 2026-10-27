"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BENEFIT_TYPE_LABEL, money, thDate } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { batchBenefits, batchPremiums, type ActionState } from "./actions";

export type InsLine = {
  id: string; policyId: string; policy: string; person: string | null; no: number; due: string; remaining: number; currency: string;
  status: string; benefitType: string | null;
};
export type PayOpt = { value: string; label: string; currency: string };

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS: Record<string, { text: string; cls: string }> = {
  OVERDUE: { text: "เลยกำหนด", cls: "text-red-600" }, PARTIAL: { text: "จ่ายบางส่วน", cls: "text-amber-700" }, PENDING: { text: "รอ", cls: "text-slate-500" },
};

/**
 * แท็บ "จ่ายชำระเบี้ยประกัน" (PREMIUM) / "บันทึกรับผลประโยชน์" (BENEFIT) ของหน้า Insurance (ตกลง 27 ต.ค. 2026)
 *   งวดที่ยังไม่จ่าย / ยังไม่รับ ของทุกกรมธรรม์ (ตั้งต้น: เลยกำหนด + ภายใน 60 วัน · ติ๊กเพื่อแสดงทุกงวด)
 *   วันที่ช่องเดียวใช้กับทุกแถว · ช่องยอดว่าง = ไม่บันทึก · กดบันทึกครั้งเดียว · ผิดแถวเดียว = ไม่บันทึกเลย
 */
export default function InsuranceBatch({ kind, rows, pays, today, soon, minDate, canWrite }: {
  kind: "PREMIUM" | "BENEFIT"; rows: InsLine[]; pays: PayOpt[]; today: string; soon: string; minDate: string; canWrite: boolean;
}) {
  const prem = kind === "PREMIUM";
  const router = useRouter();
  const cf = useConfirmSubmit();
  const firstPay = (ccy: string) => pays.find((p) => p.currency === ccy)?.value ?? "";
  const [date, setDate] = useState(today);
  const [all, setAll] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [pay, setPay] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.id, firstPay(r.currency)])));
  const [state, action, pending] = useActionState<ActionState, FormData>(prem ? batchPremiums : batchBenefits, {});
  useEffect(() => { if (state.ok) { setVals({}); router.refresh(); } }, [state, router]);

  const shown = all ? rows : rows.filter((r) => r.status === "OVERDUE" || r.due <= soon);
  const hidden = rows.length - shown.length;
  const chosen = rows.filter((r) => (vals[r.id] ?? "").trim() !== "");
  const label = (r: InsLine) => `${r.policy} งวดที่ ${r.no}`;
  const payload = chosen.map((r) => ({ policy_id: r.policyId, line_id: r.id, label: label(r), amount: vals[r.id], pay: pay[r.id] ?? "", currency: r.currency }));
  const payName = new Map(pays.map((p) => [p.value, p.label]));
  const what = prem ? "จ่ายเบี้ย" : "รับผลประโยชน์";
  const onSubmit = cf.guard(`บันทึก${what} ${chosen.length} รายการ วันที่ ${thDate(date)} ?\n${chosen.map((r) =>
    `• ${label(r)} ${vals[r.id]} ${prem ? "จาก" : "→"} ${payName.get(pay[r.id] ?? "") ?? "(ยังไม่เลือกบัญชี)"}`).join("\n")}`, { okLabel: "ยืนยันบันทึก" });

  return (
    <>
    {cf.dialog}
    <form action={action} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="rows" value={JSON.stringify(payload)} />
      {canWrite && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
          <label className="flex items-center gap-2">{prem ? "วันที่จ่าย" : "วันที่ได้รับ"}
            <input type="date" value={date} min={minDate || undefined} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className={small} />
          </label>
          <span className="text-xs text-slate-500">ใช้กับทุกแถวที่กรอก · ช่องยอดว่าง = ไม่บันทึก</span>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <h2 className="font-medium text-slate-900">{prem ? "งวดเบี้ยที่ยังไม่จ่าย" : "งวดผลประโยชน์ที่ยังไม่ได้รับ"}</h2>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {(hidden > 0 || all) && (
              <label className="flex items-center gap-2 text-slate-600">
                <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
                แสดงทุกงวด{hidden > 0 ? ` (อีก ${hidden} งวด)` : ""}
              </label>
            )}
            {canWrite && shown.length > 0 && (
              <button type="button" onClick={() => setVals({ ...vals, ...Object.fromEntries(shown.filter((r) => r.remaining > 0).map((r) => [r.id, fmt(r.remaining)])) })}
                className="text-blue-700 hover:underline">ใส่ยอดตามงวดทุกแถว</button>
            )}
          </div>
        </div>
        <table className="mt-3 w-full min-w-[52rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">กรมธรรม์</th><th className="px-3">งวด / ครบกำหนด</th><th className="px-3 text-right">{prem ? "ยอดค้าง" : "ยอดที่จะได้รับ"}</th>
              {canWrite && <><th className="px-3 text-right">{prem ? "ยอดที่จ่าย" : "ยอดที่ได้รับ"}</th><th className="px-3">{prem ? "จ่ายจาก" : "เข้าบัญชี"}</th></>}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">
              {rows.length === 0 ? `ไม่มีงวด${prem ? "เบี้ย" : "ผลประโยชน์"}ที่ค้าง (ตั้งตารางได้ที่หน้ากรมธรรม์)` : "ไม่มีงวดที่เลยกำหนดหรือถึงกำหนดใน 60 วัน"}</td></tr>}
            {shown.map((r) => {
              const v = vals[r.id] ?? "";
              const st = STATUS[r.status];
              return (
                <tr key={r.id} className={v.trim() ? "bg-blue-50/40" : ""}>
                  <td className="px-3 py-2">
                    <Link href={`/insurance/${r.policyId}`} className="font-medium text-slate-900 hover:underline">{r.policy}</Link>
                    {r.person && <div className="text-xs text-slate-500">{r.person}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 text-xs">งวดที่ {r.no}{r.benefitType ? ` · ${BENEFIT_TYPE_LABEL[r.benefitType] ?? r.benefitType}` : ""}
                    <div>{thDate(r.due)}{st && <span className={`ml-1 ${st.cls}`}>· {st.text}</span>}</div></td>
                  <td className="px-3 text-right tabular-nums">{money(r.remaining, r.currency)}</td>
                  {canWrite && <>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button type="button" onClick={() => setVals({ ...vals, [r.id]: fmt(r.remaining) })} className="mr-2 text-xs text-blue-700 hover:underline">ตามงวด</button>
                      <input inputMode="decimal" value={v} placeholder={r.currency} aria-label={`ยอด ${label(r)}`}
                        onChange={(e) => setVals({ ...vals, [r.id]: e.target.value })} className={`w-32 text-right ${small}`} />
                    </td>
                    <td className="px-3">
                      <select value={pay[r.id] ?? ""} onChange={(e) => setPay({ ...pay, [r.id]: e.target.value })} className={`max-w-[15rem] ${small}`}
                        aria-label={`${prem ? "จ่ายจาก" : "เข้าบัญชี"} ${label(r)}`}>
                        <option value="">{prem ? "— เลือกบัญชี / บัตร —" : "— เลือกบัญชี —"}</option>
                        {pays.filter((p) => p.currency === r.currency).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                    </td>
                  </>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={pending || chosen.length === 0} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : `บันทึก${what} ${chosen.length} รายการ`}
          </button>
          {chosen.length > 0 && !pending && <button type="button" onClick={() => setVals({})} className="text-sm text-slate-500 underline hover:text-slate-800">ล้างช่องที่กรอก</button>}
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
        </div>
      )}
      <p className="text-xs text-slate-500">
        {prem ? <>ลงค่าใช้จ่ายหมวด &ldquo;ประกัน&rdquo; ผูกงวด · กรมธรรม์ที่มีตารางมูลค่าเวนคืนตามสัญญา ลงมูลค่าเวนคืนต่อให้ · จ่ายเป็นเงินสด / จ่ายจากพอร์ต ทำที่หน้ากรมธรรม์</>
          : <>ถอนจากมูลค่าเวนคืนก่อน ส่วนที่เกินเป็นรายได้ &ldquo;ผลประโยชน์ประกัน&rdquo; · ครบสัญญา / เวนคืน / สินไหม (ปิดกรมธรรม์) ทำที่หน้ากรมธรรม์</>}
        {" "}· รายการไหนผิด จะไม่บันทึกเลยทั้งชุด
      </p>
    </form>
    </>
  );
}
