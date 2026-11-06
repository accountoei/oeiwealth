"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SMALL_BTN, BENEFIT_TYPE_LABEL, INS_OPEN, INS_SCHED_STATUS, money, thDate } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import YearSelect from "@/components/YearSelect";
import { RecordedLines, type Recorded } from "@/lib/recorded-edit";
import { batchBenefits, batchPremiums, type ActionState } from "./actions";
import { InfoTip } from "@/components/HeaderBar";
import { BatchBar, BatchSave, FillAll } from "@/components/BatchSave";
import type { ReactNode } from "react";

/** แถวจาก v_insurance_schedule_status */
export type YLine = { id: string; policy_id: string; kind: string; installment_no: number; due_date: string; amount: number; currency: string;
  benefit_type: string | null; paid_amount: number; remaining: number; status: string };
export type BoxLine = {
  id: string; no: number; due: string; amount: number;
  /** จ่าย / รับแล้ว (ก่อน Go-live นับเต็มงวด) · คงเหลือ (ปิด / ไม่ได้จ่าย = 0) */ paid: number; remaining: number;
  currency: string; status: string; benefitType: string | null;
  /** ที่จ่าย / รับแล้วของงวด (ทีละครั้ง · กดเพื่อแก้ / ยกเลิก) */ edits?: Recorded[];
  /** งวดนอกปีที่เลือก: "ค้างจากปี 2568" / "งวดปี 2570" */ tag?: string | null;
};
export type BoxPolicy = { id: string; name: string; person: string | null; active: boolean; lines: BoxLine[];
  /** จ่ายเบี้ยจาก (ค่าตั้งต้นของกรมธรรม์ "a:" / "c:" · ว่าง = บัญชีแรกของสกุล) */ pay?: string;
  /** รับเงินก้อนที่ไม่ผูกงวด (ครบสัญญา / เวนคืน / สินไหม) ในปีที่เลือก */ lumps: Recorded[] };
export type PayOpt = { value: string; label: string; currency: string };

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cur = (c: string) => (c !== "THB" ? c : undefined);

/**
 * แท็บ "บันทึกรับผลประโยชน์" (BENEFIT) / "จ่ายชำระเบี้ยประกัน" (PREMIUM) — กล่องเดียวต่อปีแบบเงินให้กู้ (ตกลง 3 พ.ย. 2026)
 *   กรมธรรม์ละกลุ่ม: งวดในปีที่เลือก (ปีนี้ = รวมงวดค้างจากปีก่อน + งวดที่ครบภายใน 60 วัน) · ยอดงวด / จ่าย-รับแล้ว (กดแก้) / คงเหลือ
 *   ช่องกรอกเฉพาะงวดที่ถึงกำหนด (ติ๊กเพื่อเปิดงวดที่ยังไม่ถึง) · วันที่ช่องเดียวใช้กับทุกแถว · ผิดแถวเดียว = ไม่บันทึกเลย
 */
export default function InsuranceBatch({ kind, year, years, hrefOf, policies, pays, today, defaultDate = today, soon, minDate, canWrite, filter }: {
  kind: "PREMIUM" | "BENEFIT"; year: number; years: { value: number; mark?: string }[]; hrefOf: string; policies: BoxPolicy[];
  pays: PayOpt[]; today: string; defaultDate?: string; soon: string; minDate: string; canWrite: boolean;
  /** ตัวกรองบริษัทประกัน (ต่อจากชื่อในแถบบน) */ filter?: ReactNode;
}) {
  const prem = kind === "PREMIUM";
  const router = useRouter();
  const cf = useConfirmSubmit();
  const lines = policies.flatMap((p) => p.lines.map((l) => ({ ...l, policyId: p.id, policy: p.name, active: p.active })));
  const payOf = new Map(policies.map((p) => [p.id, p.pay ?? ""]));
  // ค่าตั้งต้นของกรมธรรม์ก่อน (ถ้ายังใช้ได้และสกุลตรง · ตกลง 3 พ.ย. 2026) ไม่งั้นบัญชีแรกของสกุล
  const firstPay = (ccy: string, def = "") => (def && pays.some((p) => p.value === def && p.currency === ccy) ? def : pays.find((p) => p.currency === ccy)?.value ?? "");
  const [date, setDate] = useState(defaultDate);
  const [all, setAll] = useState(false);
  const [expand, setExpand] = useState<Record<string, boolean>>({});
  const [vals, setVals] = useState<Record<string, string>>({});
  const [pay, setPay] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, firstPay(l.currency, payOf.get(l.policyId))])));
  const [state, action, pending] = useActionState<ActionState, FormData>(prem ? batchPremiums : batchBenefits, {});
  useEffect(() => { if (state.ok) { setVals({}); router.refresh(); } }, [state, router]);

  const open = (l: (typeof lines)[number]) => l.active && INS_OPEN.includes(l.status) && l.remaining > 0.005;
  const due = (l: (typeof lines)[number]) => open(l) && (l.status === "OVERDUE" || l.due <= soon);
  const canInput = (l: (typeof lines)[number]) => canWrite && (due(l) || (all && open(l)));
  const later = lines.filter((l) => open(l) && !due(l)).length;
  const chosen = lines.filter((l) => canInput(l) && (vals[l.id] ?? "").trim() !== "");
  const label = (l: (typeof lines)[number]) => `${l.policy} งวดที่ ${l.no}`;
  const payload = chosen.map((l) => ({ policy_id: l.policyId, line_id: l.id, label: label(l), amount: vals[l.id], pay: pay[l.id] ?? "", currency: l.currency }));
  const payName = new Map(pays.map((p) => [p.value, p.label]));
  const what = prem ? "จ่ายเบี้ย" : "รับผลประโยชน์";
  const onSubmit = cf.guard(`บันทึก${what} ${chosen.length} รายการ ณ วันที่ ${thDate(date)} ?\n${chosen.map((l) =>
    `• ${label(l)} ${vals[l.id]} ${prem ? "จาก" : "→"} ${payName.get(pay[l.id] ?? "") ?? "(ยังไม่เลือกบัญชี)"}`).join("\n")}`, { okLabel: "ยืนยันบันทึก" });
  const statusText = (s: string) => s === "PAID" ? (prem ? "จ่ายแล้ว" : "รับแล้ว") : s === "PENDING" ? (prem ? "รอจ่าย" : "รอรับ") : INS_SCHED_STATUS[s]?.text ?? s;
  // ยอดรวมท้ายกล่อง = งวดที่ครบในปีที่เลือกเท่านั้น (งวดค้างจากปีก่อน / งวดปีหน้า แสดงในกล่องแต่ไม่นับรวม)
  const inYear = (l: BoxLine) => !l.tag;
  const thb = lines.filter((l) => l.currency === "THB" && inYear(l));
  const outside = lines.some((l) => !inYear(l));
  const sum = (f: (l: BoxLine) => number) => thb.reduce((t, l) => t + f(l), 0);
  // กรมธรรม์ที่มีหลายงวดในปี (รายเดือน / ไตรมาส): งวดที่จบแล้วรวมเป็นบรรทัดเดียว กดเพื่อดูทุกงวด
  const finished = (l: BoxLine) => ["PAID", "HISTORY", "SKIPPED", "CLOSED"].includes(l.status);
  const cols = canWrite ? 7 : 5;

  return (
    <>
    {cf.dialog}
    {/* ฟอร์มบันทึกครอบเฉพาะแถบบันทึกด้านบน (BatchSave) ไม่ครอบตาราง: ในตารางมีปุ่ม "ยกเลิก" ที่เป็นฟอร์มของตัวเอง (ฟอร์มซ้อนฟอร์ม = กดไม่ได้ · 5 พ.ย. 2026) */}
    <div className="space-y-3">
      {/* แถบบนแบบเดียวกันทุกหน้า (ตกลง 6 พ.ย. 2026): ชื่อ · บริษัท · ปี · ใส่ยอดทุกแถว | บันทึก + วันที่ */}
      <BatchBar
        title={<>{prem ? "เบี้ยประกัน" : "ผลประโยชน์"} ปี {year + 543}
          <InfoTip label="คำอธิบาย">
        {prem ? <>ลงค่าใช้จ่ายหมวด &ldquo;ประกัน&rdquo; ผูกงวด · กรมธรรม์ที่มีตารางมูลค่าเวนคืนตามสัญญา ลงมูลค่าเวนคืนต่อให้ · จ่ายเป็นเงินสด / จ่ายจากพอร์ต ทำที่หน้ากรมธรรม์
          {" "}· กดยอดที่จ่ายแล้วเพื่อแก้ / ลบ (ลบแล้วงวดกลับเป็น &ldquo;รอจ่าย&rdquo; · เดือนที่ปิดแล้วต้อง Reopen ก่อน)</>
          : <>ถอนจากมูลค่าเวนคืนก่อน ส่วนที่เกินเป็นรายได้ &ldquo;ผลประโยชน์ประกัน&rdquo; · แก้ยอดที่รับ: กด &ldquo;ยกเลิก&rdquo; (ย้อนทั้งก้อน) แล้วบันทึกใหม่
          {" "}· ครบสัญญา / เวนคืน / สินไหม (ปิดกรมธรรม์) ทำและยกเลิกที่หน้ากรมธรรม์</>}
        {" "}· รายการไหนผิด จะไม่บันทึกเลยทั้งชุด
          </InfoTip></>}
        filters={<>{filter}<YearSelect options={years} value={year} hrefOf={hrefOf} />
          {canWrite && later > 0 && (
            <label className="flex items-center gap-2 text-slate-600">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
              เปิดช่องกรอกงวดที่ยังไม่ถึงกำหนด ({later})
            </label>
          )}</>}
        fill={canWrite && <FillAll disabled={!lines.some(canInput)}
          onClick={() => setVals({ ...vals, ...Object.fromEntries(lines.filter(canInput).map((l) => [l.id, fmt(l.remaining)])) })} />}>
        {canWrite && (
          <BatchSave action={action} onSubmit={onSubmit} fields={{ date, rows: JSON.stringify(payload) }}
            count={chosen.length} pending={pending} onClear={() => setVals({})} state={state}
            date={date} onDate={setDate} minDate={minDate} maxDate={today}
            info={<>วันที่ด้านขวาใช้กับทุกแถวที่กรอก · ช่องยอดว่าง = ไม่บันทึก</>} />
        )}
      </BatchBar>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[60rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            {/* ทุกคอลัมน์ยกเว้นชื่อกว้างคงที่ → กรอกตัวเลขแล้วคอลัมน์ไม่ขยับ */}
            <tr><th className="min-w-[12rem] px-3 py-2">กรมธรรม์ / {prem ? "ผู้จ่าย" : "ผู้เอาประกัน"}</th><th className="w-48 px-3">งวด / ครบกำหนด</th>
              <th className="w-32 px-3 text-right">ยอดงวด</th><th className="w-44 px-3 text-right">{prem ? "จ่ายแล้ว" : "รับแล้ว"}</th><th className="w-32 px-3 text-right">คงเหลือ</th>
              {canWrite && <><th className="w-52 px-3 text-right">{prem ? "ยอดที่จ่าย" : "ยอดที่ได้รับ"}</th><th className="w-56 px-3">{prem ? "จ่ายจาก" : "เข้าบัญชี"}</th></>}</tr>
          </thead>
          {policies.length === 0 && (
            <tbody><tr><td colSpan={cols} className="px-4 py-6 text-center text-slate-500">
              ไม่มีงวด{prem ? "เบี้ย" : "ผลประโยชน์"}ในปี {year + 543} (ตั้งตารางได้ที่หน้ากรมธรรม์)</td></tr></tbody>
          )}
          {policies.map((p) => {
            const yl = p.lines.filter(inYear);
            const done = p.lines.filter(finished);
            const fold = p.lines.length > 4 && done.length > 1 && !expand[p.id];
            const shown = fold ? p.lines.filter((l) => !finished(l)) : p.lines;
            const head = (
              <td rowSpan={Math.max(shown.length + (fold ? 1 : 0), 1)} className="px-3 py-2 align-top">
                <Link href={`/insurance/${p.id}`} className="font-medium text-slate-900 hover:underline">{p.name}</Link>
                {p.person && <div className="text-xs text-slate-500">{p.person}</div>}
                {yl.length > 1 && <div className="text-xs text-slate-500">{yl.length} งวดในปี · รวม {money(yl.reduce((t, l) => t + l.amount, 0), cur(yl[0].currency))}</div>}
                {p.lines.length > 4 && done.length > 1 && (expand[p.id] || !canWrite) && (
                  <button type="button" onClick={() => setExpand({ ...expand, [p.id]: !expand[p.id] })} className={`${SMALL_BTN} mt-1`}>
                    {expand[p.id] ? "ย่องวดที่จบแล้ว" : `แสดงทุกงวด (${p.lines.length})`}</button>
                )}
                {!p.active && <div className="text-xs text-slate-400">กรมธรรม์ไม่มีผลแล้ว</div>}
                <RecordedLines items={p.lumps} />
              </td>
            );
            return (
              <tbody key={p.id} className="divide-y divide-slate-100 border-t border-slate-200">
                {p.lines.length === 0 && <tr>{head}<td colSpan={cols - 1} className="px-3 py-2 text-xs text-slate-400">ไม่มีงวดในปีนี้ · รับเงินก้อน</td></tr>}
                {fold && (
                  <tr className="align-top text-slate-500">
                    {head}
                    <td className="whitespace-nowrap px-3 py-2 text-xs">งวดที่ {done[0].no}–{done.at(-1)?.no} · จบแล้ว {done.length} งวด
                      <div className="mt-0.5">{thDate(done[0].due)} – {thDate(done.at(-1)?.due)}</div></td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(done.reduce((t, l) => t + l.amount, 0), cur(done[0].currency))}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(done.reduce((t, l) => t + l.paid, 0), cur(done[0].currency))}</td>
                    <td className="px-3 py-2 text-right text-slate-300">-</td>
                    {canWrite && <td colSpan={2} className="px-3 py-2 text-xs"><button type="button" onClick={() => setExpand({ ...expand, [p.id]: true })}
                      className={SMALL_BTN}>ดู / แก้ทีละงวด</button></td>}
                  </tr>
                )}
                {shown.map((l, i) => {
                  const x = { ...l, policyId: p.id, policy: p.name, active: p.active };
                  const v = vals[l.id] ?? "";
                  const st = INS_SCHED_STATUS[l.status];
                  return (
                    <tr key={l.id} className={`align-top ${v.trim() ? "bg-blue-50/40" : ""}`}>
                      {i === 0 && !fold && head}
                      <td className="whitespace-nowrap px-3 py-2 text-xs">งวดที่ {l.no}{l.benefitType ? ` · ${BENEFIT_TYPE_LABEL[l.benefitType] ?? l.benefitType}` : ""}
                        <div className="mt-0.5">{thDate(l.due)} <span className={`ml-1 rounded px-1.5 py-0.5 ${st?.cls ?? ""}`}>{statusText(l.status)}</span></div>
                        {l.tag && <div className={l.due < `${year}-01-01` ? "text-red-600" : "text-slate-500"}>{l.tag}</div>}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(l.amount, cur(l.currency))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.edits?.length ? <RecordedLines items={l.edits} /> : l.paid > 0.005 ? <span className="text-slate-500">{money(l.paid, cur(l.currency))}</span> : <span className="text-slate-300">-</span>}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${l.status === "OVERDUE" ? "text-red-700" : ""}`}>
                        {l.remaining > 0.005 ? money(l.remaining, cur(l.currency)) : <span className="text-slate-300">-</span>}</td>
                      {canWrite && (canInput(x) ? <>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <button type="button" onClick={() => setVals({ ...vals, [l.id]: fmt(l.remaining) })} className="mr-2 text-xs text-blue-700 hover:underline">ตามงวด</button>
                          <input inputMode="decimal" value={v} placeholder={l.currency} aria-label={`ยอด ${label(x)}`}
                            onChange={(e) => setVals({ ...vals, [l.id]: e.target.value })} className={`w-32 text-right ${small}`} />
                        </td>
                        <td className="px-3 py-2">
                          <select value={pay[l.id] ?? ""} onChange={(e) => setPay({ ...pay, [l.id]: e.target.value })} className={`w-full max-w-[15rem] ${small}`}
                            aria-label={`${prem ? "จ่ายจาก" : "เข้าบัญชี"} ${label(x)}`}>
                            <option value="">{prem ? "— เลือกบัญชี / บัตร —" : "— เลือกบัญชี —"}</option>
                            {pays.filter((o) => o.currency === l.currency).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </td>
                      </> : (
                        <td colSpan={2} className="px-3 py-2 text-xs">
                          {l.status === "PAID" ? <span className="text-emerald-700">{prem ? "จ่ายครบแล้ว" : "รับครบแล้ว"} ✓</span>
                            : open(x) ? <span className="text-slate-400">ยังไม่ถึงกำหนด</span> : null}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
          {thb.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
              <tr><td colSpan={2} className="px-3 py-2">รวมปี {year + 543} (THB){outside && <div className="text-xs font-normal text-slate-500">ไม่รวมงวดค้างจากปีก่อน / งวดปีหน้า</div>}</td>
                <td className="px-3 text-right tabular-nums">{money(sum((l) => l.amount))}</td>
                <td className={`px-3 text-right tabular-nums ${prem ? "text-red-700" : "text-emerald-700"}`}>{money(sum((l) => l.paid))}</td>
                <td className="px-3 text-right tabular-nums">{money(sum((l) => l.remaining))}</td>
                {canWrite && <td colSpan={2} />}</tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
    </>
  );
}
