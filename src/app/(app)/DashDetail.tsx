"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import Modal from "@/components/Modal";
import { InfoTip } from "@/components/HeaderBar";
import { baht } from "@/lib/format";
import { loadGroupChanges, loadInvestmentGain, loadMonthFlows, type GroupChange, type InvestmentGain, type MonthFlows, type Row } from "./dashboard-detail";

/** กรอบกล่องบน Dashboard · ปุ่ม "ดูรายละเอียด ›" มุมขวาบน → pop up (popup สร้างตอนกดเท่านั้น)
 *  (ตกลง 1 พ.ย. 2026: กดได้เฉพาะปุ่ม ไม่ใช่ทั้งกล่อง → ตารางในกล่องอ่านด้วยโปรแกรมอ่านหน้าจอได้ตามปกติ)
 *  ใช้กับกล่อง "Net Worth เปลี่ยนเพราะอะไร" และ "สัดส่วนสินทรัพย์ตามหมวด" (รอบ 4) */
export function PopupBox({ title, hint, info, children, popupTitle, popup, className = "" }: {
  title: ReactNode; hint?: string; info?: ReactNode; children: ReactNode; popupTitle: string; popup: ReactNode; className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={`rounded-xl border border-slate-200 bg-white p-4 sm:p-5 xl:p-4 ${className}`}>
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-1">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {info && <span className="mt-0.5 shrink-0"><InfoTip label="คำอธิบายกล่องนี้">{info}</InfoTip></span>}
          </div>
          <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
            className="-mr-2 -mt-1 inline-flex min-h-9 shrink-0 items-center rounded-md px-2 text-xs text-blue-700 hover:bg-blue-50 hover:underline sm:min-h-7">
            {hint ?? "ดูรายละเอียด ›"}</button>
        </div>
        {children}
      </div>
      {open && (
        <Modal title={popupTitle} size="lg" onClose={() => setOpen(false)}>
          <div data-keep-open>{popup}</div>
        </Modal>
      )}
    </>
  );
}

/** ตัวเลขของกล่อง "Net Worth เปลี่ยนเพราะอะไร" (คำนวณใน page.tsx · changeBridge) */
export type Bridge = {
  prevLabel: string; prev: number; income: number; investment: number; expense: number; expenseUntracked: boolean; net: number;
  gain: number; fx: number; other: number; cur: number; endLabel: string; person: boolean;
};

function useLoad<T>(fn: () => Promise<T | { error: string }>) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    let alive = true;
    fn().then((r) => { if (!alive) return; if (r && typeof r === "object" && "error" in r) setErr(r.error); else setData(r as T); setDone(true); })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { data, err, done };
}

const Loading = () => <p className="animate-pulse text-sm text-slate-500">กำลังโหลด…</p>;
const sign = (v: number) => (v > 0 ? "text-emerald-700" : v < 0 ? "text-red-700" : "text-slate-500");

/** รายการย่อยใต้บรรทัดที่กาง: ชื่อ (จำนวนรายการ) · % · ยอด */
function SubRows({ rows, total, empty, negative }: { rows: Row[]; total: number; empty: string; negative?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="py-1 pr-3">{r.label}{r.count ? <span className="text-xs text-slate-400"> ({r.count})</span> : null}</td>
            <td className="w-16 py-1 pr-3 text-right text-xs tabular-nums text-slate-500">{total ? `${((r.value * 100) / total).toFixed(1)}%` : ""}</td>
            <td className={`py-1 text-right tabular-nums ${negative ? "text-red-700" : ""}`}>{baht(r.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** หัวข้อเล็กในส่วนที่กาง + ⓘ คำอธิบาย (แทนย่อหน้าหมายเหตุยาว) */
function SubHead({ children, info }: { children: ReactNode; info?: ReactNode }) {
  return (
    <div className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
      {children}{info && <InfoTip label="คำอธิบาย">{info}</InfoTip>}
    </div>
  );
}

/** pop up "Net Worth เปลี่ยนเพราะอะไร" (ตกลง 2 พ.ย. 2026 · แบบ ก.): ตารางสรุปเดียวกับในกล่อง
 *  กดบรรทัดเพื่อกางรายละเอียดใต้บรรทัดนั้น · ไม่มีปุ่มลิงก์ไปหน้าอื่น · หมายเหตุอยู่ใน ⓘ */
export function ChangeDetail({ start, personId, b }: { start: string; personId: string; b: Bridge }) {
  const { data: f, err: e1 } = useLoad<MonthFlows>(() => loadMonthFlows(start, personId));
  const { data: g, err: e2 } = useLoad<GroupChange[]>(() => loadGroupChanges(start, personId));
  const { data: ig, err: e3, done: igDone } = useLoad<InvestmentGain | null>(() => loadInvestmentGain(start, personId));
  const err = e1 || e2 || e3;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const wait = err ? <p className="text-sm text-red-600">โหลดไม่สำเร็จ: {err}</p> : <Loading />;

  const lines: { key: string; label: string; v: number; signed?: boolean; bold?: boolean; note?: ReactNode; text?: string; detail?: ReactNode }[] = [
    { key: "prev", label: b.prevLabel, v: b.prev, bold: true },
    { key: "income", label: "+ รายได้สุทธิ (หลังภาษี)", v: b.income,
      detail: f ? <><SubHead>แยกตามประเภท</SubHead><SubRows rows={f.income} total={f.incomeTotal} empty="ไม่มีรายได้" /></> : wait },
    { key: "investment", label: b.person ? "+ รายได้ลงทุน (ตามสัดส่วนถือ)" : "+ รายได้ลงทุน", v: b.investment,
      detail: f ? <><SubHead>แยกตามพอร์ต</SubHead><SubRows rows={f.investment} total={f.investmentTotal} empty="ไม่มีรายได้ลงทุน" /></> : wait },
    { key: "expense", label: b.person ? "− ค่าใช้จ่ายสุทธิ (ที่ระบุชื่อ)" : "− ค่าใช้จ่ายสุทธิ", v: b.expense,
      text: b.expenseUntracked ? "ยังไม่ได้บันทึก" : undefined,
      detail: f ? (
        <div className="space-y-3">
          <div>
            <SubHead info={f.reimbursements ? <>ยอดตามหมวดเป็นยอดก่อนหักเงินคืน {baht(f.reimbursements)} · ค่าใช้จ่ายสุทธิ = ค่าใช้จ่าย − เงินคืน</> : undefined}>แยกตามหมวด</SubHead>
            <SubRows rows={f.expense} total={f.expenseTotal} empty="ไม่มีค่าใช้จ่าย" negative />
          </div>
          {f.topExpenses.length > 0 && (
            <div>
              <SubHead>ค่าใช้จ่ายสูงสุด {Math.min(5, f.topExpenses.length)} รายการ</SubHead>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {f.topExpenses.slice(0, 5).map((e, i) => (
                    <tr key={i}>
                      <td className="w-14 py-1 pr-3 text-xs text-slate-500">{e.date.slice(8, 10)}/{e.date.slice(5, 7)}</td>
                      <td className="py-1 pr-3">{e.label}{e.category && <span className="text-xs text-slate-400"> · {e.category}</span>}</td>
                      <td className="py-1 text-right tabular-nums text-red-700">{baht(e.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : wait },
    { key: "gain", label: b.person ? "± กำไร / ขาดทุนเงินลงทุน (ตามสัดส่วนถือ)" : "± กำไร / ขาดทุนเงินลงทุน", v: b.gain, signed: true,
      note: b.fx ? <>ในนั้นจาก FX {b.fx > 0 ? "+" : ""}{baht(b.fx)}</> : null,
      detail: !igDone ? wait : ig && ig.by_portfolio.length > 0 ? <GainTable ig={ig} /> : <p className="text-sm text-slate-500">ไม่มีพอร์ตลงทุน</p> },
    { key: "other", label: "± มูลค่าเปลี่ยน / อื่น ๆ", v: b.other, signed: true,
      detail: g ? <OtherTable gs={g} other={b.other} /> : wait },
    { key: "end", label: b.endLabel, v: b.cur, bold: true },
    // ตารางยอดทุกหมวดแยกเป็นบรรทัดสุดท้าย (4 พ.ย. 2026 · เดิมอยู่ใต้ "อื่น ๆ" → แถวการลงทุนซ้ำกับบรรทัดกำไร / ขาดทุน ดูสับสน)
    { key: "groups", label: "ยอดตามหมวด ต้นงวด → สิ้นงวด", note: "รวมผลของทุกบรรทัดข้างบน", v: b.cur - b.prev, signed: true,
      detail: g ? <GroupTable gs={g} /> : wait },
  ];

  return (
    <div className="space-y-2">
      <div className="divide-y divide-slate-100 text-sm">
        {lines.map((l) => {
          const isOpen = open.has(l.key);
          const num = l.text
            ? <span className="text-xs text-slate-500">{l.text}</span>
            : <span className={`tabular-nums ${l.bold ? "text-ink" : ""} ${!l.bold && l.v < 0 ? "text-red-700" : ""}`}>{l.signed && Math.round(l.v) > 0 ? "+" : ""}{baht(l.v)}</span>;
          const label = <span className="min-w-0 text-left">{l.label}{l.note && <span className="block pl-3 text-xs font-normal text-slate-500">{l.note}</span>}</span>;
          return (
            // บรรทัดตารางยอดตามหมวดเว้นห่างจาก "= ณ วันนี้" เล็กน้อย (เป็นตารางอ้างอิง ไม่ใช่บรรทัดที่บวกต่อ)
            <div key={l.key} className={`${l.bold ? "font-medium" : ""} ${l.key === "groups" ? "mt-2" : ""}`}>
              {l.detail ? (
                <button type="button" onClick={() => toggle(l.key)} aria-expanded={isOpen}
                  className="-mx-2 flex w-[calc(100%+1rem)] items-start justify-between gap-3 rounded-md px-2 py-2 hover:bg-slate-50">
                  <span className="flex min-w-0 items-start gap-1.5">
                    <span className={`mt-0.5 text-xs text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden="true">▸</span>
                    {label}
                  </span>
                  {num}
                </button>
              ) : (
                <div className="flex items-start justify-between gap-3 py-2 pl-[1.125rem]">{label}{num}</div>
              )}
              {l.detail && isOpen && <div className="mb-3 ml-[1.125rem] rounded-lg bg-slate-50 px-3 py-2">{l.detail}</div>}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">กดบรรทัดที่มี ▸ เพื่อดูรายละเอียด{personId ? " · ส่วนของสมาชิกที่เลือก (ตามสัดส่วน)" : ""}</p>
    </div>
  );
}

/** มูลค่าตามหมวด ต้นงวด → สิ้นงวด (ใต้บรรทัด "มูลค่าเปลี่ยน / อื่น ๆ") */
/** "อื่น ๆ" แยกตามหมวด (4 พ.ย. 2026 · แบบ ก.): เฉพาะส่วนที่ไม่ได้อยู่ในบรรทัดข้างบน · รวมแล้ว = บรรทัด "อื่น ๆ" พอดี
 *  เงินฝากธนาคาร + การลงทุน = ยอดเปลี่ยนของสองหมวดนี้ − รายได้ / ค่าใช้จ่าย / กำไร / ขาดทุนข้างบน (เงินจากบรรทัดเหล่านั้นเข้า-ออกสองหมวดนี้)
 *  คิดเป็นยอดที่เหลือจาก "อื่น ๆ" หลังหักหมวดอื่น → ผลรวมตรงกับบรรทัดเสมอ · หมวดอื่น = ยอดเปลี่ยนทั้งหมวด · แสดงเฉพาะแถวที่ไม่ใช่ 0 */
function OtherTable({ gs, other }: { gs: GroupChange[]; other: number }) {
  const rest = gs.filter((r) => r.key !== "FINANCIAL" && r.key !== "INVESTMENT")
    .map((r) => ({ key: r.key, label: r.label, v: (r.end - r.start) * (r.key === "LIABILITY" ? -1 : 1) }));   // หนี้เพิ่ม = ความมั่งคั่งลด
  const liquid = other - rest.reduce((t, r) => t + r.v, 0);
  const rows = [{ key: "LIQUID", label: "เงินฝากธนาคาร + การลงทุน", v: liquid }, ...rest].filter((r) => Math.round(r.v) !== 0);
  return (
    <>
      <SubHead info={<>&ldquo;อื่น ๆ&rdquo; = ประเมินมูลค่าใหม่ (อสังหาฯ / ธุรกิจ / ทอง / สินทรัพย์อื่น) · อัตราแลกเปลี่ยนของเงินฝากต่างประเทศ · ยอดหนี้ · รายการที่ยังไม่ได้บันทึก ·
        &ldquo;เงินฝากธนาคาร + การลงทุน&rdquo; = ส่วนที่ไม่ได้อยู่ในบรรทัดรายได้ ค่าใช้จ่าย และกำไร / ขาดทุนข้างบน ·
        เงินที่ย้ายระหว่างหมวดจะเห็นทั้งสองฝั่ง (เช่น จ่ายเงินซื้ออสังหาฯ 1,000,000: อสังหาริมทรัพย์ +1,000,000 · เงินฝาก −1,000,000 รวมแล้ว 0) ·
        หนี้สินเพิ่ม = Net Worth ลด</>}>แยกตามหมวด (เฉพาะส่วนที่เป็น &ldquo;อื่น ๆ&rdquo;)</SubHead>
      {rows.length === 0 ? <p className="text-sm text-slate-500">ไม่มี</p> : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="py-1 pr-3">{r.label}{r.key === "LIQUID" && <span className="block text-xs text-slate-500">ส่วนที่ไม่ได้อยู่ในบรรทัดข้างบน</span>}</td>
                <td className={`py-1 text-right align-top tabular-nums ${sign(r.v)}`}>{r.v > 0 ? "+" : ""}{baht(r.v)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 1 && (
            <tfoot className="border-t border-slate-200 font-medium">
              <tr><td className="py-1">รวม</td><td className={`text-right tabular-nums ${sign(other)}`}>{other > 0 ? "+" : ""}{baht(other)}</td></tr>
            </tfoot>
          )}
        </table>
      )}
    </>
  );
}

function GroupTable({ gs }: { gs: GroupChange[] }) {
  const nw = (k: "start" | "end") => gs.reduce((t, r) => t + (r.key === "LIABILITY" ? -r[k] : r[k]), 0);
  return (
    <>
      <SubHead info={<>ยอดทุกหมวด ต้นงวด → สิ้นงวด · &ldquo;เปลี่ยน&rdquo; รวม = ผลของทุกบรรทัดข้างบนรวมกัน (รายได้ ค่าใช้จ่าย กำไร / ขาดทุน และอื่น ๆ) ·
        &ldquo;เปลี่ยน&rdquo; ของแต่ละหมวดรวมเงินที่ย้ายระหว่างหมวดด้วย (เช่น โอนธนาคาร → พอร์ต 100,000: เงินฝาก −100,000 · การลงทุน +100,000) ·
        หนี้สินเพิ่ม = Net Worth ลด</>}>มูลค่าตามหมวด ต้นงวด → สิ้นงวด</SubHead>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="py-1 font-normal">หมวด</th><th className="text-right font-normal">ต้นงวด</th><th className="text-right font-normal">สิ้นงวด</th><th className="text-right font-normal">เปลี่ยน</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {gs.map((r) => {
              const d = (r.end - r.start) * (r.key === "LIABILITY" ? -1 : 1);       // หนี้เพิ่ม = ความมั่งคั่งลด
              return (
                <tr key={r.key}>
                  <td className="py-1 pr-2">{r.label}</td>
                  <td className={`text-right tabular-nums ${r.key === "LIABILITY" ? "text-red-700" : ""}`}>{baht(r.start)}</td>
                  <td className={`text-right tabular-nums ${r.key === "LIABILITY" ? "text-red-700" : ""}`}>{baht(r.end)}</td>
                  <td className={`text-right tabular-nums ${sign(d)}`}>{d > 0 ? "+" : ""}{baht(d)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-slate-200 font-medium">
            <tr><td className="py-1">Net Worth</td><td className="text-right tabular-nums">{baht(nw("start"))}</td>
              <td className="text-right tabular-nums">{baht(nw("end"))}</td>
              <td className={`text-right tabular-nums ${sign(nw("end") - nw("start"))}`}>{nw("end") - nw("start") > 0 ? "+" : ""}{baht(nw("end") - nw("start"))}</td></tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

/** กำไร / ขาดทุนเงินลงทุนตามพอร์ต: สิ้นงวด − ต้นงวด − เงินเข้า / ออก (โอน · ซื้อขายผ่านบัญชีธนาคาร · ปันผลที่เข้าพอร์ต · จ่ายออก) */
function GainTable({ ig }: { ig: InvestmentGain }) {
  const rows = ig.by_portfolio;
  return (
    <>
      <SubHead info={<>กำไร / ขาดทุน = สิ้นงวด − ต้นงวด − เงินเข้า / ออก · รวมราคาเปลี่ยน · ขายต่างจากราคาล่าสุด · ค่าธรรมเนียม / ภาษีในพอร์ต · อัตราแลกเปลี่ยนของพอร์ต ·
        &ldquo;เงินเข้า / ออก&rdquo; = โอนกับธนาคาร · ซื้อขายผ่านบัญชีธนาคาร · ปันผล / ดอกเบี้ยที่เข้าพอร์ต (อยู่ในรายได้ลงทุนแล้ว) · จ่ายค่าใช้จ่าย / บัตรจากพอร์ต ·
        &ldquo;จาก FX&rdquo; เป็นยอดประมาณ (มูลค่าต้นงวด × อัตราที่เปลี่ยน)</>}>แยกตามพอร์ต</SubHead>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="py-1 font-normal">พอร์ต</th><th className="text-right font-normal">ต้นงวด</th><th className="text-right font-normal">เงินเข้า / ออก</th>
              <th className="text-right font-normal">สิ้นงวด</th><th className="text-right font-normal">กำไร / ขาดทุน</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.asset_id} className="align-top">
                <td className="py-1 pr-2"><Link href={`/investments/${r.asset_id}`} className="hover:underline">{r.name}</Link></td>
                <td className="text-right tabular-nums">{baht(r.start)}</td>
                <td className="text-right tabular-nums text-slate-500">{r.flows ? `${r.flows > 0 ? "+" : ""}${baht(r.flows)}` : "-"}</td>
                <td className="text-right tabular-nums">{baht(r.end)}</td>
                <td className={`text-right tabular-nums ${sign(r.gain)}`}>
                  {r.gain > 0 ? "+" : ""}{baht(r.gain)}
                  {r.fx !== 0 && <div className="text-xs text-slate-500">จาก FX {r.fx > 0 ? "+" : ""}{baht(r.fx)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 1 && (
            <tfoot className="border-t border-slate-200 font-medium">
              <tr><td className="py-1" colSpan={4}>รวม</td>
                <td className={`text-right tabular-nums ${sign(ig.gain)}`}>{ig.gain > 0 ? "+" : ""}{baht(ig.gain)}</td></tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
