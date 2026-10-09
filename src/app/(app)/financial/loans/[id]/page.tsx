import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { MOVE_LABEL, money, thDate, todayBangkok } from "@/lib/format";
import { DisburseForm, PaymentForm } from "./forms";
import RowActions from "@/components/RowActions";
import OwnershipEditor from "@/components/OwnershipEditor";
import DeleteEntity from "@/components/DeleteEntity";
import StatusSelect from "@/components/StatusSelect";
import EntityDocuments from "@/components/docs/EntityDocuments";
import { ScheduleEditor } from "./schedule-editor";
import { addMonthsKeepDay, LOAN_SCHED_STATUS } from "@/lib/loan-schedule";

type Sched = { id: string; installment_no: number; due_date: string; principal_due: number; interest_due: number; total_due: number;
  notes: string | null; principal_remaining: number; interest_remaining: number; total_remaining: number; status: string };

export default async function LoanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: l }, { data: owners }, { data: moves }, { data: incomes }, { data: banks }, { data: family }, { data: persons }, { data: schedRaw }] = await Promise.all([
    supabase.from("v_loans_status").select("*").eq("asset_id", id).maybeSingle(),
    supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", id),
    supabase.from("cash_movements").select("id,movement_date,movement_type,from_asset_id,to_asset_id,amount,description,is_derived")
      .or(`from_asset_id.eq.${id},to_asset_id.eq.${id}`).is("deleted_at", null).order("movement_date", { ascending: false }),
    supabase.from("income_transactions").select("id,date,amount,tax,currency,notes").eq("asset_id", id).eq("income_type", "LOAN_INTEREST")
      .is("deleted_at", null).order("date", { ascending: false }),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("created_at"),
    supabase.from("v_loan_schedule_status").select("id,installment_no,due_date,principal_due,interest_due,total_due,notes,principal_remaining,interest_remaining,total_remaining,status")
      .eq("loan_asset_id", id).order("due_date").order("installment_no"),
  ]);
  if (!l) notFound();
  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const today = todayBangkok();
  const goLive = family?.go_live_date ?? "";
  const paths = [`/financial/loans/${id}`, "/financial/loans", "/financial/cash", "/income-expenses"];
  const activeOwners = (owners ?? []).filter((o) => !o.end_date);
  const ownerTotal = activeOwners.reduce((s, o) => s + Number(o.ownership_percent), 0);
  const repaid = (moves ?? []).filter((m) => m.movement_type === "LOAN_PRINCIPAL_RECEIPT").reduce((s, m) => s + Number(m.amount), 0);
  const interest = (incomes ?? []).reduce((s, i) => s + Number(i.amount), 0);
  // ตารางผ่อน: งวดที่ยังไม่ครบ = เลยกำหนด / รับบางส่วน / งวดถัดไป → มีปุ่มบันทึกรับ (เติมยอดคงค้างของงวดให้)
  const sched = (schedRaw as Sched[] | null) ?? [];
  const open = sched.filter((x) => x.status !== "PAID" && x.status !== "WRITTEN_OFF");
  const nextDue = open.find((x) => x.status !== "OVERDUE");
  const overdue = open.filter((x) => x.status === "OVERDUE");
  const overdueAmt = overdue.reduce((s, x) => s + Number(x.total_remaining), 0);
  const payable = new Set([...overdue.map((x) => x.id), ...(nextDue ? [nextDue.id] : [])]);
  const schedP = sched.reduce((s, x) => s + Number(x.principal_due), 0);
  const loanOpen = l.status !== "CLOSED" && l.status !== "WRITTEN_OFF";
  const bankName = new Map((banks ?? []).map((b) => [b.asset_id, b.name]));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/financial/loans" className="text-sm text-slate-500 hover:underline">← Loans Receivable</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{l.name}</h1>
        <p className="text-sm text-slate-500">ผู้กู้ {l.borrower_name} · {l.currency}{l.derived_status === "OVERDUE" && <span className="text-red-600"> · เลยกำหนดคืน</span>}</p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">เงินต้นคงเหลือ</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{money(l.status === "WRITTEN_OFF" ? 0 : l.outstanding_principal, l.currency)}</div>
          <div className="mt-1 text-xs text-slate-500">เงินต้น {money(l.principal)} · รับคืนแล้ว {money(repaid)} · ดอกเบี้ยรับแล้ว {money(interest)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
          <div className="text-xs text-slate-500">เงื่อนไข</div>
          <ul className="mt-1 space-y-0.5">
            <li>ดอกเบี้ย {l.interest_rate != null ? `${Number(l.interest_rate)}% ต่อปี` : "-"}</li>
            <li>ให้กู้ {thDate(l.loan_date)} · ครบ {thDate(l.due_date)}</li>
            <li>ยอดตั้งต้น {money(l.opening_outstanding_principal)} ณ {thDate(l.opening_date)}</li>
          </ul>
          {canWrite && <div className="mt-2"><RowActions table="loan_details" id={l.id} paths={paths} canDelete={false} fields={[
            { name: "borrower_name", label: "ผู้กู้", value: l.borrower_name },
            { name: "interest_rate", label: "ดอกเบี้ย %", type: "number", value: l.interest_rate, width: "w-20" },
            { name: "due_date", label: "ครบกำหนด", type: "date", value: l.due_date },
            { name: "notes", label: "หมายเหตุ", value: l.notes, width: "w-40" }]} /></div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">ผู้ให้กู้ (เจ้าของ)</div>
          <ul className="mt-1 space-y-0.5 text-sm">{activeOwners.map((o) => <li key={o.person_id}>{o.person_name} · {Number(o.ownership_percent)}%</li>)}</ul>
          {ownerTotal < 100 && <div className="mt-1 text-xs text-amber-700">ยังไม่ระบุเจ้าของ {100 - ownerTotal}%</div>}
          {canWrite && <OwnershipEditor kind="asset" id={id} persons={persons ?? []} paths={paths} today={today}
            current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent) }))} />}
        </div>
      </section>

      {canWrite && l.status !== "CLOSED" && l.status !== "WRITTEN_OFF" && (
        <div className="flex flex-wrap gap-2">
          <PaymentForm assetId={id} currency={l.currency} banks={banks ?? []} today={today} minDate={goLive} />
          <DisburseForm assetId={id} currency={l.currency} banks={banks ?? []} today={today} minDate={goLive} />
        </div>
      )}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium text-slate-900">ตารางผ่อนชำระ</h2>
            {sched.length > 0 ? (
              <div className="mt-0.5 text-sm text-slate-600">
                {sched.length} งวด · รวมเงินต้นตามตาราง {money(schedP, l.currency)}
                {nextDue && <> · งวดถัดไป {thDate(nextDue.due_date)} <span className="tabular-nums">{money(nextDue.total_remaining)}</span></>}
                {overdue.length > 0 && <span className="text-red-600"> · เลยกำหนด {overdue.length} งวด รวม {money(overdueAmt)}</span>}
                {open.length === 0 && <span className="text-emerald-700"> · รับครบทุกงวดแล้ว</span>}
              </div>
            ) : <p className="mt-0.5 text-sm text-slate-500">ยังไม่ได้ตั้งตารางผ่อน — ตั้งได้จากสูตร หรือวางจาก Excel</p>}
            {sched.length > 0 && Math.abs(schedP - Number(l.principal)) > 0.01 && (
              <p className="mt-0.5 text-xs text-amber-700">เงินต้นตามตาราง ({money(schedP)}) ไม่เท่ากับเงินต้นของสัญญา ({money(l.principal)}) — สถานะ &ldquo;รับแล้ว&rdquo; อาจคลาดเคลื่อน</p>
            )}
          </div>
          {canDelete && loanOpen && (
            <ScheduleEditor assetId={id} currency={l.currency} hasSchedule={sched.length > 0}
              current={sched.map((x) => ({ due_date: x.due_date, principal: Number(x.principal_due), interest: Number(x.interest_due), notes: x.notes ?? undefined }))}
              defaults={{ amount: Number(l.principal ?? 0), ratePct: Number(l.interest_rate ?? 0),
                firstDue: addMonthsKeepDay(l.loan_date ?? today, 1) }} />
          )}
        </div>
        {sched.length > 0 && (
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
                <tr><th className="py-1">งวด</th><th>ครบกำหนด</th><th className="text-right">เงินต้น</th><th className="text-right">ดอกเบี้ย</th>
                  <th className="text-right">รวม</th><th className="pl-4">สถานะ</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sched.map((x) => {
                  const st = LOAN_SCHED_STATUS[x.status];
                  const part = x.status !== "PAID" && Number(x.total_remaining) < Number(x.total_due);
                  return (
                    <tr key={x.id} className={`align-top ${x.status === "PAID" ? "text-slate-400" : ""}`}>
                      <td className="py-1.5">{x.installment_no}</td>
                      <td>{thDate(x.due_date)}{x.notes && <div className="text-xs text-slate-400">{x.notes}</div>}</td>
                      <td className="text-right tabular-nums">{money(x.principal_due)}</td>
                      <td className="text-right tabular-nums">{money(x.interest_due)}</td>
                      <td className="text-right tabular-nums">{money(x.total_due)}</td>
                      <td className="pl-4">
                        <span className={`rounded px-1.5 py-0.5 text-xs ${st?.cls ?? ""}`}>{st?.text ?? x.status}</span>
                        {part && <div className="text-xs text-slate-500">ค้าง {money(x.total_remaining)}</div>}
                      </td>
                      <td className="pl-2 text-right">
                        {canWrite && loanOpen && payable.has(x.id) && (
                          <PaymentForm assetId={id} currency={l.currency} banks={banks ?? []} today={today} minDate={goLive} small button="บันทึกรับ"
                            title={`รับชำระงวดที่ ${x.installment_no} (ครบ ${thDate(x.due_date)})`}
                            principal={Number(x.principal_remaining)} interest={Number(x.interest_remaining)} />
                        )}
                        {canWrite && <div className="mt-1"><RowActions table="loan_schedule_lines" id={x.id} paths={paths} canDelete={canDelete} fields={[
                          { name: "due_date", label: "ครบกำหนด", type: "date", value: x.due_date },
                          { name: "principal_due", label: "เงินต้น", type: "number", value: x.principal_due },
                          { name: "interest_due", label: "ดอกเบี้ย", type: "number", value: x.interest_due },
                          { name: "notes", label: "หมายเหตุ", value: x.notes, width: "w-40" }]} /></div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {sched.length > 0 && <p className="text-xs text-slate-500">
          สถานะคิดจากยอดที่รับจริง: เงินต้นที่ลดลงแล้วตัดงวดเรียงจากงวดแรก · ดอกเบี้ยนับเฉพาะงวดหลังวันยอดตั้งต้น ({thDate(l.opening_date)}) ·
          ตารางผ่อนเป็นแผน ไม่กระทบยอดเงิน — ยอดจริงมาจาก &ldquo;บันทึกรับชำระ&rdquo; เท่านั้น
        </p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-slate-900">ประวัติให้กู้ / รับชำระ</h2>
        {(moves ?? []).length === 0 && (incomes ?? []).length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการ (ยอดตั้งต้นอยู่ด้านบน)</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">วันที่</th><th>ประเภท</th><th>บัญชี</th><th className="text-right">จำนวน</th><th></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(moves ?? []).map((m) => (
                <tr key={m.id}>
                  <td className="py-1.5">{thDate(m.movement_date)}</td>
                  <td>{m.movement_type === "LOAN_PRINCIPAL_RECEIPT" ? "รับคืนเงินต้น" : MOVE_LABEL[m.movement_type] ?? m.movement_type}</td>
                  <td className="text-xs text-slate-500">{bankName.get(m.from_asset_id === id ? m.to_asset_id : m.from_asset_id) ?? ""}</td>
                  <td className={`text-right tabular-nums ${m.movement_type === "LOAN_DISBURSEMENT" ? "" : "text-emerald-700"}`}>{money(m.amount)}</td>
                  <td className="pl-2 text-right">
                    {canWrite && !m.is_derived && <RowActions table="cash_movements" id={m.id} paths={paths} canDelete={canDelete} fields={[
                      { name: "movement_date", label: "วันที่", type: "date", value: m.movement_date },
                      { name: "amount", label: "จำนวน", type: "number", value: m.amount }]} />}
                  </td>
                </tr>
              ))}
              {(incomes ?? []).map((i) => (
                <tr key={i.id}>
                  <td className="py-1.5">{thDate(i.date)}</td><td>ดอกเบี้ยรับ (รายได้)</td><td className="text-xs text-slate-500">{Number(i.tax ?? 0) ? `ภาษี ${money(i.tax)}` : ""}</td>
                  <td className="text-right tabular-nums text-emerald-700">{money(i.amount)}</td>
                  <td className="pl-2 text-right">
                    {canWrite && <RowActions table="income_transactions" id={i.id} paths={paths} canDelete={canDelete} fields={[
                      { name: "date", label: "วันที่", type: "date", value: i.date }, { name: "amount", label: "ดอกเบี้ย", type: "number", value: i.amount },
                      { name: "tax", label: "ภาษี", type: "number", value: i.tax }]} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {canWrite && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <StatusSelect table="loan_details" id={l.id} value={l.status} paths={paths} label="สถานะ"
            options={[["ACTIVE", "ปกติ"], ["AT_RISK", "มีความเสี่ยงไม่ได้คืน"], ["CLOSED", "ปิดแล้ว (ได้คืนครบ)"], ["WRITTEN_OFF", "ตัดหนี้สูญ (มูลค่าเป็น 0)"]]} />
          {canDelete && <div><DeleteEntity kind="asset" id={id} redirectTo="/financial/loans" paths={["/financial/loans"]} label="ลบรายการนี้"
            hint="ลบได้เมื่อไม่มีรายการให้กู้ / รับชำระ" /></div>}
        </section>
      )}
      <EntityDocuments entityType="ASSET" entityId={id} module="FINANCIAL" role={me.role} paths={paths} />
    </div>
  );
}
