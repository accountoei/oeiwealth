import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { money, thDate, thDateLong, todayBangkok } from "@/lib/format";
import PrintShell, { type PrintSection } from "./print-shell";
import { LoanContract, ScheduleAnnex, type ContractData } from "./contract";

export const metadata = { title: "พิมพ์สัญญาเงินให้กู้" };

/**
 * หน้าพิมพ์ของเงินให้กู้ (นอกเมนูหลัก · ขนาด A4) — เลือกพิมพ์ได้ทีละส่วน แต่ละส่วนขึ้นหน้าใหม่
 * 1) สัญญากู้ยืมเงิน (ร่างจากข้อมูลในระบบ 1 หน้า) 2) ตารางผ่อนชำระแนบท้าย 3) ประวัติรับชำระ (ใบแจ้งยอด) 4) รายการเอกสารแนบ
 */
export default async function PrintLoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAppUser();
  const supabase = await createClient();
  const [{ data: l }, { data: extra }, { data: owners }, { data: sched }, { data: moves }, { data: incomes }, { data: links }] = await Promise.all([
    supabase.from("v_loans_status").select("asset_id,name,currency,borrower_name,principal,outstanding_principal,interest_rate,loan_date,due_date,opening_date,opening_outstanding_principal").eq("asset_id", id).maybeSingle(),
    supabase.from("loan_details").select("borrower_phone,contract_no,purpose").eq("asset_id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("v_asset_ownerships_active").select("person_name,ownership_percent,end_date").eq("asset_id", id),
    supabase.from("loan_schedule_lines").select("installment_no,due_date,principal_due,interest_due").eq("loan_asset_id", id).is("deleted_at", null)
      .order("due_date").order("installment_no"),
    supabase.from("cash_movements").select("id,movement_date,movement_type,amount,movement_group_id").eq("from_asset_id", id).eq("movement_type", "LOAN_PRINCIPAL_RECEIPT")
      .is("deleted_at", null),
    supabase.from("income_transactions").select("id,date,amount").eq("asset_id", id).eq("income_type", "LOAN_INTEREST").is("deleted_at", null),
    supabase.from("document_links").select("documents(id,title,document_type,version_status,deleted_at)").eq("entity_type", "ASSET").eq("entity_id", id).is("deleted_at", null),
  ]);
  if (!l) notFound();
  const today = todayBangkok();
  const d: ContractData = {
    contractNo: extra?.contract_no ?? null, loanDate: l.loan_date, dueDate: l.due_date, currency: l.currency,
    borrower: l.borrower_name, borrowerPhone: extra?.borrower_phone ?? null, purpose: extra?.purpose ?? null,
    lenders: (owners ?? []).filter((o) => !o.end_date).map((o) => o.person_name as string),
    principal: Number(l.principal ?? 0), ratePct: l.interest_rate == null ? null : Number(l.interest_rate),
    lines: (sched ?? []).map((x) => ({ no: x.installment_no, due: x.due_date, principal: Number(x.principal_due), interest: Number(x.interest_due) })),
  };

  // ประวัติรับชำระ: รวมเงินต้น + ดอกเบี้ยของวันเดียวกันเป็นแถวเดียว (ตรงกับยอดที่ผู้กู้โอน)
  const byDate = new Map<string, { p: number; i: number }>();
  (moves ?? []).forEach((m) => { const e = byDate.get(m.movement_date) ?? { p: 0, i: 0 }; e.p += Number(m.amount); byDate.set(m.movement_date, e); });
  (incomes ?? []).forEach((x) => { const e = byDate.get(x.date) ?? { p: 0, i: 0 }; e.i += Number(x.amount); byDate.set(x.date, e); });
  const history = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  type Doc = { id: string; title: string; document_type: string; version_status: string; deleted_at: string | null };
  const docs = (links ?? []).map((x) => (Array.isArray(x.documents) ? x.documents[0] : x.documents) as Doc | null)
    .filter((x): x is Doc => !!x && !x.deleted_at && x.version_status === "CURRENT");

  const warn: string[] = [];
  if (d.ratePct != null && d.ratePct > 15) warn.push(`อัตราดอกเบี้ย ${d.ratePct}% ต่อปี เกินร้อยละ 15 ต่อปี (เพดานเงินกู้ระหว่างบุคคล) — ตรวจสอบก่อนใช้สัญญา`);
  if (d.lenders.length === 0) warn.push("ยังไม่ได้ระบุผู้ให้กู้ (เจ้าของ) — ช่องผู้ให้กู้จะเว้นว่าง");
  warn.push("ร่างสัญญาจากแบบมาตรฐานทั่วไป ไม่ใช่คำปรึกษากฎหมาย — ควรให้ทนายตรวจข้อความก่อนใช้จริง · ช่องเส้นประให้เขียนด้วยมือ");

  const sections: PrintSection[] = [
    { key: "contract", label: "สัญญากู้ยืมเงิน", on: true, node: <LoanContract d={d} /> },
    ...(d.lines.length ? [{ key: "schedule", label: "ตารางผ่อนชำระ (แนบท้าย)", on: true, node: <ScheduleAnnex d={d} /> }] : []),
    { key: "history", label: "ประวัติรับชำระ", on: false, note: "ใบแจ้งยอดให้ผู้กู้", node: (
      <article className="text-[12px]">
        <h2 className="text-center text-base font-semibold">รายการรับชำระเงินกู้</h2>
        <p className="text-center">{l.name} · ผู้กู้ {l.borrower_name} · ณ วันที่ {thDateLong(today)}</p>
        <table className="mt-3 w-full border-collapse">
          <thead><tr className="border-y border-slate-400 text-left"><th className="py-1">วันที่รับ</th><th className="text-right">เงินต้น</th><th className="text-right">ดอกเบี้ย</th><th className="text-right">รวม</th></tr></thead>
          <tbody>
            {history.length === 0 && <tr><td colSpan={4} className="py-3 text-center text-slate-500">ยังไม่มีรายการรับชำระในระบบ</td></tr>}
            {history.map(([dt, e]) => (
              <tr key={dt} className="border-b border-slate-200"><td className="py-0.5">{thDate(dt)}</td>
                <td className="text-right tabular-nums">{money(e.p)}</td><td className="text-right tabular-nums">{money(e.i)}</td><td className="text-right tabular-nums">{money(e.p + e.i)}</td></tr>
            ))}
          </tbody>
        </table>
        <dl className="mt-4 grid grid-cols-[14rem_auto] gap-y-1">
          <dt>เงินต้นตามสัญญา</dt><dd className="tabular-nums">{money(l.principal, l.currency)}</dd>
          {Number(l.opening_outstanding_principal) !== Number(l.principal) && <>
            <dt>ยอดคงเหลือยกมา ณ {thDate(l.opening_date)}</dt><dd className="tabular-nums">{money(l.opening_outstanding_principal, l.currency)}</dd></>}
          <dt className="font-semibold">เงินต้นคงเหลือ ณ วันนี้</dt><dd className="font-semibold tabular-nums">{money(l.outstanding_principal, l.currency)}</dd>
        </dl>
      </article>
    ) },
    { key: "docs", label: `รายการเอกสารแนบ (${docs.length})`, on: docs.length > 0, note: "ไฟล์อยู่ใน Google Drive — กด เปิด แล้วพิมพ์ทีละไฟล์", node: (
      <article className="text-[13px]">
        <h2 className="text-center text-base font-semibold">รายการเอกสารแนบ</h2>
        <p className="text-center">{l.name} · ผู้กู้ {l.borrower_name}</p>
        {docs.length === 0 ? <p className="mt-4 text-center text-slate-500">ยังไม่มีเอกสารแนบ</p> : (
          <ol className="mt-4 list-decimal space-y-1 pl-6">
            {docs.map((x) => (
              <li key={x.id}>{x.title} <span className="text-slate-500">· {x.document_type}</span>
                <a href={`/view/${x.id}`} target="_blank" rel="noopener" className="ml-2 text-xs text-blue-700 underline print:hidden">เปิดเพื่อพิมพ์</a></li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs text-slate-500 print:hidden">ไฟล์เก็บใน Google Drive จึงรวมพิมพ์ในหน้านี้ไม่ได้ — กด &ldquo;เปิดเพื่อพิมพ์&rdquo; แล้วสั่งพิมพ์จากหน้านั้นทีละไฟล์</p>
      </article>
    ) },
  ];
  return <PrintShell back={`/financial/loans/${id}`} sections={sections} warn={warn} />;
}
