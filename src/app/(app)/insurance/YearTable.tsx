import Link from "next/link";
import { BENEFIT_TYPE_LABEL, INS_SCHED_STATUS, money, thDate } from "@/lib/format";

export type YLine = { id: string; policy_id: string; kind: string; installment_no: number; due_date: string; amount: number; currency: string;
  benefit_type: string | null; paid_amount: number; remaining: number; status: string };
type YPolicy = { id: string; insurer: string; policy_no: string | null; person_id: string | null; payer_person_id: string | null; status: string };
export const OPEN = ["PENDING", "OVERDUE", "PARTIAL"];
const FREQ: Record<number, string> = { 12: "รายเดือน", 4: "รายไตรมาส", 2: "ราย 6 เดือน", 1: "รายปี" };
const MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/**
 * ตารางทั้งปี (เบี้ยที่ต้องจ่าย / ผลประโยชน์ที่จะได้รับ): กรมธรรม์ละ 1 แถว = ยอดรวมทั้งปี
 * จ่ายหลายงวดในปี (รายเดือน / ไตรมาส) → กดแถวเพื่อดูว่าเดือนไหน ยอดเท่าไร จ่ายแล้วหรือยัง
 */
export default function YearTable({ kind, year, groups, pname, prevHref, nextHref, thisHref }: {
  kind: "PREMIUM" | "BENEFIT"; year: number; groups: { r: YPolicy; lines: YLine[] }[]; pname: Map<string, string>;
  prevHref: string; nextHref: string; thisHref?: string;
}) {
  const prem = kind === "PREMIUM";
  const sum = (xs: YLine[], f: (l: YLine) => number) => xs.reduce((t, l) => t + Number(f(l)), 0);
  const thb = groups.flatMap((g) => g.lines).filter((l) => l.currency === "THB");
  const other = groups.some((g) => g.lines.some((l) => l.currency !== "THB"));
  const cols = "grid grid-cols-[minmax(12rem,2fr)_minmax(7rem,1fr)_minmax(6rem,1fr)_repeat(3,minmax(6.5rem,1fr))] items-start gap-x-3";
  return (
    <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
        <h2 className="font-medium text-slate-900">{prem ? "เบี้ยที่ต้องจ่าย" : "ผลประโยชน์ที่จะได้รับ"} ปี {year + 543}</h2>
        <div className="flex items-center gap-1 text-xs">
          <Link href={prevHref} scroll={false} className="rounded-full border border-slate-300 px-2.5 py-0.5 text-slate-600 hover:bg-slate-50">‹ {year + 542}</Link>
          {thisHref && <Link href={thisHref} scroll={false} className="rounded-full border border-slate-300 px-2.5 py-0.5 text-slate-600 hover:bg-slate-50">ปีนี้</Link>}
          <Link href={nextHref} scroll={false} className="rounded-full border border-slate-300 px-2.5 py-0.5 text-slate-600 hover:bg-slate-50">{year + 544} ›</Link>
        </div>
      </div>
      {groups.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">{prem ? "ไม่มีเบี้ยครบกำหนดในปีนี้" : "ไม่มีผลประโยชน์ครบกำหนดในปีนี้"} (ดึงจากตาราง{prem ? "เบี้ย" : "ผลประโยชน์"}ของแต่ละกรมธรรม์)</p>
      ) : (
        <div className="mt-2 min-w-[52rem] text-sm">
          <div className={`${cols} bg-slate-50 px-4 py-2 text-xs text-slate-500`}>
            <div>กรมธรรม์</div><div>{prem ? "ผู้จ่าย" : "ผู้เอาประกัน"}</div><div>งวดในปี</div>
            <div className="text-right">ยอดทั้งปี</div><div className="text-right">{prem ? "จ่ายแล้ว" : "รับแล้ว"}</div><div className="text-right">คงเหลือ</div>
          </div>
          <div className="divide-y divide-slate-100">
            {groups.map(({ r, lines }) => {
              const ccy = lines[0].currency;
              const who = prem ? (r.payer_person_id ?? r.person_id) : r.person_id;
              const overdue = lines.filter((l) => l.status === "OVERDUE").length;
              const row = (
                <>
                  <div><Link href={`/insurance/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.insurer}{r.policy_no && ` · ${r.policy_no}`}</Link>
                    {!prem && <div className="text-xs text-slate-500">{[...new Set(lines.map((l) => BENEFIT_TYPE_LABEL[l.benefit_type ?? "OTHER"]))].join(" · ")}</div>}</div>
                  <div>{who ? pname.get(who) ?? "-" : "-"}</div>
                  <div className="text-xs">{lines.length > 1 && <span className="mr-1 text-slate-400 group-open:hidden">▸</span>}
                    {lines.length > 1 && <span className="mr-1 hidden text-slate-400 group-open:inline">▾</span>}
                    {lines.length} งวด{FREQ[lines.length] && ` · ${FREQ[lines.length]}`}
                    {lines.length === 1 && <div className="text-slate-500">{thDate(lines[0].due_date)}</div>}
                    {overdue > 0 && <div className="text-red-600">เลยกำหนด {overdue} งวด</div>}</div>
                  <div className="text-right tabular-nums">{money(sum(lines, (l) => l.amount), ccy)}</div>
                  <div className="text-right tabular-nums text-slate-600">{money(sum(lines, (l) => l.paid_amount), ccy)}</div>
                  <div className="text-right tabular-nums">{money(sum(lines, (l) => (l.status === "CLOSED" ? 0 : l.remaining)), ccy)}</div>
                </>
              );
              if (lines.length === 1) return <div key={r.id} className={`${cols} px-4 py-2.5`}>{row}</div>;
              return (
                <details key={r.id} className="group">
                  <summary className={`${cols} cursor-pointer list-none px-4 py-2.5 hover:bg-slate-50 [&::-webkit-details-marker]:hidden`}>{row}</summary>
                  <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-2">
                    {lines.map((l) => {
                      const st = INS_SCHED_STATUS[l.status];
                      return (
                        <div key={l.id} className={`${cols} py-1 text-xs`}>
                          <div className="pl-4">{MONTH[Number(l.due_date.slice(5, 7)) - 1]} · งวดที่ {l.installment_no}</div>
                          <div className="text-slate-500">{thDate(l.due_date)}</div>
                          <div><span className={`rounded px-1.5 py-0.5 ${st?.cls ?? ""}`}>{st?.text ?? l.status}</span></div>
                          <div className="text-right tabular-nums">{money(l.amount, l.currency)}</div>
                          <div className="text-right tabular-nums text-slate-600">{Number(l.paid_amount) > 0 ? money(l.paid_amount, l.currency) : "-"}</div>
                          <div className="text-right tabular-nums">{l.status === "CLOSED" ? "-" : money(l.remaining, l.currency)}</div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
          <div className={`${cols} border-t-2 border-slate-200 bg-slate-50/60 px-4 py-3 text-xs font-medium`}>
            <div className="text-sm">รวม {groups.length} กรมธรรม์ (THB){other && <span className="font-normal text-slate-500"> · ไม่รวมสกุลอื่น</span>}</div><div></div><div></div>
            <div className="text-right tabular-nums">{money(sum(thb, (l) => l.amount), "THB")}</div>
            <div className="text-right tabular-nums">{money(sum(thb, (l) => l.paid_amount), "THB")}</div>
            <div className="text-right tabular-nums">{money(sum(thb, (l) => (l.status === "CLOSED" ? 0 : l.remaining)), "THB")}</div>
          </div>
        </div>
      )}
    </section>
  );
}
