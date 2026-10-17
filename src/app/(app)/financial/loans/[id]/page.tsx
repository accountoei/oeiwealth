import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { MOVE_LABEL, money, thDate, todayBangkok } from "@/lib/format";
import { DisburseForm, LoanInfoForm, PaymentForm } from "./forms";
import EditToggle from "@/components/EditToggle";
import RowActions from "@/components/RowActions";
import UndoButton from "@/components/UndoButton";
import OwnershipEditor from "@/components/OwnershipEditor";
import StatusSelect from "@/components/StatusSelect";
import EntityDocuments from "@/components/docs/EntityDocuments";
import { ScheduleEditor } from "./schedule-editor";
import { RestructureEditor } from "./restructure-editor";
import { addMonthsKeepDay, LOAN_SCHED_STATUS } from "@/lib/loan-schedule";
import { ActionBar } from "@/components/ActionBar";
import { loanInterestFields } from "@/lib/source-edit";

type Sched = { id: string; installment_no: number; due_date: string; principal_due: number; interest_due: number; total_due: number;
  notes: string | null; principal_remaining: number; interest_remaining: number; total_remaining: number; status: string };

export default async function LoanDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ restructure?: string }>;
}) {
  const { id } = await params;
  const rs = (await searchParams).restructure;
  const preset = rs === "end" || rs === "payment" ? rs : undefined;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: l }, { data: owners }, { data: moves }, { data: incomes }, { data: banks }, { data: family }, { data: persons }, { data: schedRaw }] = await Promise.all([
    supabase.from("v_loans_status").select("*").eq("asset_id", id).maybeSingle(),
    supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", id),
    supabase.from("cash_movements").select("id,movement_date,movement_type,from_asset_id,to_asset_id,amount,description,is_derived,movement_group_id")
      .or(`from_asset_id.eq.${id},to_asset_id.eq.${id}`).is("deleted_at", null).order("movement_date", { ascending: false }),
    supabase.from("income_transactions").select("id,date,amount,tax,currency,notes,received_to_asset_id").eq("asset_id", id).eq("income_type", "LOAN_INTEREST")
      .is("deleted_at", null).order("date", { ascending: false }),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
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
  // ดอกเบี้ยค้างสะสมถึงงวดนั้น (ใช้แบ่งยอดรวมที่รับ: หักดอกก่อน ที่เหลือเป็นต้น)
  const interestOwedUpTo = (date: string) => sched.filter((x) => x.due_date <= date).reduce((s, x) => s + Number(x.interest_remaining), 0);
  const principalDueUpTo = (date: string) => sched.filter((x) => x.due_date <= date).reduce((s, x) => s + Number(x.principal_remaining), 0);
  // คำนวณงวดที่เหลือใหม่: ค่าตั้งต้น
  const restartAt = nextDue?.due_date ?? addMonthsKeepDay(today, 1);
  const periodsLeft = open.filter((x) => x.due_date >= restartAt).length || open.length;
  const prevDue = sched.filter((x) => x.due_date < restartAt).at(-1)?.due_date ?? l.loan_date ?? undefined;
  const methodGuess = open.length > 1 && open.slice(0, -1).every((x) => Number(x.principal_due) === 0) ? "INTEREST_ONLY" as const : "EQUAL_PAYMENT" as const;
  const schedP = sched.reduce((s, x) => s + Number(x.principal_due), 0);
  const loanOpen = l.status !== "CLOSED" && l.status !== "WRITTEN_OFF";
  // บันทึกรับชำระแล้ว → แก้ตารางทั้งชุดไม่ได้ · งวดที่รับแล้วแก้ / ลบไม่ได้ (ฐานข้อมูลบังคับ: 20261010000200_loan_schedule_locks)
  const hasPayments = (moves ?? []).some((m) => m.movement_type === "LOAN_PRINCIPAL_RECEIPT") || (incomes ?? []).length > 0;
  // ประวัติ: การรับชำระครั้งเดียว (เงินต้น + ดอกเบี้ย) แสดงเป็น 1 แถว ยอดรวมตรงกับ Statement ธนาคาร
  // จับคู่ด้วย movement_group_id ที่ receive_loan_payment ใส่ให้ทั้งรายการเงินต้นและรายการเงินเข้าของดอกเบี้ย
  const incomeIds = (incomes ?? []).map((i) => i.id);
  const { data: incMoves } = incomeIds.length
    ? await supabase.from("cash_movements").select("source_entity_id,movement_group_id")
        .eq("source_entity_type", "INCOME").in("source_entity_id", incomeIds).is("deleted_at", null)
    : { data: [] as { source_entity_id: string; movement_group_id: string | null }[] };
  const incGroup = new Map((incMoves ?? []).map((m) => [m.source_entity_id as string, m.movement_group_id as string | null]));
  type Mv = NonNullable<typeof moves>[number];
  type Inc = NonNullable<typeof incomes>[number];
  type Entry = { key: string; date: string; disburse?: Mv; principal?: Mv; interest?: Inc; bank: string | null };
  const entries = new Map<string, Entry>();
  (moves ?? []).forEach((m) => {
    if (m.movement_type === "LOAN_PRINCIPAL_RECEIPT") {
      const k = m.movement_group_id ?? m.id;
      entries.set(k, { ...(entries.get(k) ?? { key: k, date: m.movement_date, bank: m.to_asset_id }), principal: m });
    } else entries.set(m.id, { key: m.id, date: m.movement_date, disburse: m, bank: m.from_asset_id === id ? m.to_asset_id : m.from_asset_id });
  });
  (incomes ?? []).forEach((i) => {
    const g = incGroup.get(i.id);
    const k = g && entries.has(g) ? g : g ?? i.id;
    const e = entries.get(k);
    entries.set(k, e ? { ...e, interest: i } : { key: k, date: i.date, bank: i.received_to_asset_id, interest: i });
  });
  const history = [...entries.values()].sort((a, b) => b.date.localeCompare(a.date));
  const bankName = new Map((banks ?? []).map((b) => [b.asset_id, b.name]));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/financial/loans" className="text-sm text-slate-500 hover:underline">← Loans Receivable</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{l.name}</h1>
            <p className="text-sm text-slate-500">ผู้กู้ {l.borrower_name} · {l.currency}{l.derived_status === "OVERDUE" && <span className="text-red-600"> · เลยกำหนดคืน</span>}</p>
          </div>
          {canWrite && l.status !== "CLOSED" && l.status !== "WRITTEN_OFF" && (
            <ActionBar>
              <PaymentForm assetId={id} currency={l.currency} banks={banks ?? []} today={today} minDate={goLive}
                interestOwed={sched.length ? interestOwedUpTo(nextDue?.due_date && nextDue.due_date > today ? nextDue.due_date : today) : undefined}
                principalDue={sched.length ? principalDueUpTo(nextDue?.due_date && nextDue.due_date > today ? nextDue.due_date : today) : undefined} />
              <DisburseForm assetId={id} currency={l.currency} banks={banks ?? []} today={today} minDate={goLive} />
            </ActionBar>
          )}
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {/* ซ้าย: สรุปเงินต้น + เอกสาร (ยืดให้ขอบล่างเท่ากล่องรายละเอียด) */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs text-slate-500">เงินต้นคงเหลือ</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{money(l.status === "WRITTEN_OFF" ? 0 : l.outstanding_principal, l.currency)}</div>
            <div className="mt-1 text-xs text-slate-500">เงินต้น {money(l.principal)} · รับคืนแล้ว {money(repaid)} · ดอกเบี้ยรับแล้ว {money(interest)}</div>
          </div>
          <div className="flex-1">
            <EntityDocuments entityType="ASSET" entityId={id} module="FINANCIAL" role={me.role} paths={paths} fill />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
        <EditToggle title="รายละเอียด" canEdit={canWrite}
          view={
            <div className="space-y-4">
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Item label="ชื่อรายการ">{l.name}</Item>
                <Item label="ผู้กู้">{l.borrower_name}</Item>
                <Item label="ดอกเบี้ย">{l.interest_rate != null ? `${Number(l.interest_rate)}% ต่อปี` : "-"}</Item>
                <Item label="วันที่ให้กู้">{thDate(l.loan_date)}</Item>
                <Item label="ครบกำหนดสัญญา">{thDate(l.due_date)}</Item>
                <Item label="ยอดตั้งต้น">{money(l.opening_outstanding_principal, l.currency)} ณ {thDate(l.opening_date)}</Item>
                <Item label="สถานะ">{LOAN_STATUS_LABEL[l.status] ?? l.status}</Item>
                <Item label="ผู้ให้กู้ (เจ้าของ)">
                  {activeOwners.length === 0 ? "-" : activeOwners.map((o) => <div key={o.person_id}>{o.person_name} · {Number(o.ownership_percent)}%</div>)}
                  {ownerTotal < 100 && <div className="text-xs text-amber-700">ยังไม่ระบุเจ้าของ {100 - ownerTotal}%</div>}
                </Item>
                {l.notes && <Item label="หมายเหตุ" wide>{l.notes}</Item>}
              </dl>
            </div>
          }
          edit={
            <div className="space-y-5">
              <p className="text-xs text-slate-500">วันที่ให้กู้และยอดตั้งต้นแก้ไม่ได้ (ผูกกับรายการเงินที่บันทึกแล้ว)</p>
              <LoanInfoForm assetId={id} v={{ name: l.name, borrower_name: l.borrower_name, interest_rate: l.interest_rate == null ? null : Number(l.interest_rate), due_date: l.due_date, notes: l.notes }} />
              <div className="border-t border-slate-100 pt-4">
                <h3 className="mb-2 text-sm font-medium text-slate-800">ผู้ให้กู้ (เจ้าของ)</h3>
                <ul className="mb-2 space-y-0.5 text-sm">{activeOwners.map((o) => <li key={o.person_id}>{o.person_name} · {Number(o.ownership_percent)}%</li>)}</ul>
                <OwnershipEditor kind="asset" id={id} persons={persons ?? []} paths={paths} today={today} startOpen
                  current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent) }))} />
              </div>
              <div className="border-t border-slate-100 pt-4">
                <StatusSelect table="loan_details" id={l.id} value={l.status} paths={paths} label="สถานะ"
                  options={LOAN_STATUS_OPTIONS}
                  remove={canDelete ? { kind: "asset", id, redirectTo: "/financial/loans", paths: ["/financial/loans"], label: "ลบรายการนี้",
                    hint: "ลบได้เมื่อไม่มีรายการให้กู้ / รับชำระ" } : undefined} />
              </div>
            </div>
          } />
        </div>
      </section>


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
          {canDelete && loanOpen && open.length > 0 && (
            <RestructureEditor assetId={id} currency={l.currency} outstanding={Number(l.outstanding_principal ?? 0)}
              ratePct={Number(l.interest_rate ?? 0)}
              startDefault={restartAt} methodGuess={methodGuess} interestFrom={prevDue} preset={preset} periodsDefault={periodsLeft}
              overdueInterest={Math.round(open.filter((x) => x.due_date <= today).reduce((s, x) => s + Number(x.interest_remaining), 0) * 100) / 100}
              old={{ count: open.length, firstTotal: Number(nextDue?.total_due ?? open[0]?.total_due ?? 0),
                interest: open.reduce((s, x) => s + Number(x.interest_remaining), 0), lastDue: open.at(-1)?.due_date ?? null }} />
          )}
          {canDelete && loanOpen && (!hasPayments || sched.length === 0) && (
            <ScheduleEditor assetId={id} currency={l.currency} hasSchedule={sched.length > 0}
              current={sched.map((x) => ({ due_date: x.due_date, principal: Number(x.principal_due), interest: Number(x.interest_due), notes: x.notes ?? undefined }))}
              defaults={{ amount: Number(l.principal ?? 0), ratePct: Number(l.interest_rate ?? 0), interestFrom: l.loan_date ?? undefined,
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
                            principal={Number(x.principal_remaining)} interest={Number(x.interest_remaining)}
                            interestOwed={interestOwedUpTo(x.due_date)} principalDue={principalDueUpTo(x.due_date)} />
                        )}
                        {canWrite && !(hasPayments && x.status === "PAID") && <div className="mt-1"><RowActions table="loan_schedule_lines" id={x.id} paths={paths} canDelete={canDelete} fields={[
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
          {hasPayments && <>มีการรับชำระแล้ว: งวดที่รับแล้วแก้ / ลบไม่ได้ (ถ้าบันทึกรับผิด ให้แก้ / ลบรายการในประวัติด้านล่าง) · เปลี่ยนงวดที่เหลือใช้ &ldquo;คำนวณงวดที่เหลือใหม่&rdquo; · </>}
          สถานะคิดจากยอดที่รับจริง: เงินต้นที่ลดลงแล้วตัดงวดเรียงจากงวดแรก · ดอกเบี้ยนับเฉพาะงวดหลังวันยอดตั้งต้น ({thDate(l.opening_date)}) ·
          ตารางผ่อนเป็นแผน ไม่กระทบยอดเงิน — ยอดจริงมาจาก &ldquo;บันทึกรับชำระ&rdquo; เท่านั้น
        </p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-slate-900">ประวัติให้กู้ / รับชำระ</h2>
        {history.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการ (ยอดตั้งต้นอยู่ด้านบน)</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">วันที่</th><th>ประเภท</th><th>บัญชี</th><th className="text-right">จำนวน</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((e) => {
                const total = e.disburse ? Number(e.disburse.amount) : Number(e.principal?.amount ?? 0) + Number(e.interest?.amount ?? 0);
                const both = !!(e.principal && e.interest);
                const group = e.principal?.movement_group_id ?? (e.interest ? incGroup.get(e.interest.id) : null);
                // รับชำระครั้งเดียวกัน (เงินต้น + ดอกเบี้ย) → ปุ่มลบปุ่มเดียว ลบทั้งการรับชำระครั้งนั้น (ถ้าผิดแค่ยอด ให้แก้ยอดแทน)
                const wholeDelete = canDelete && both && group ? <UndoButton kind="PAYMENT" id={group} paths={paths} label="ลบรายการนี้"
                  confirmText={`ลบการรับชำระวันที่ ${thDate(e.date)}?\nเงินต้น ${money(e.principal?.amount)} + ดอกเบี้ย ${money(e.interest?.amount)} จะถูกลบพร้อมกัน\n(ถ้าผิดแค่ยอด ให้แก้ยอดแล้วกดบันทึกแทน)`} /> : undefined;
                return (
                  <tr key={e.key} className="align-top">
                    <td className="py-2">{thDate(e.date)}</td>
                    <td className="py-2">
                      {e.disburse ? (MOVE_LABEL[e.disburse.movement_type] ?? e.disburse.movement_type)
                        : both ? "รับชำระ" : e.principal ? "รับคืนเงินต้น" : "ดอกเบี้ยรับ (รายได้)"}
                      {/* แยกส่วน: เงินต้น (ลดยอดเงินให้กู้) · ดอกเบี้ย (รายได้) — แก้ / ลบ แยกกันได้ */}
                      {e.principal && (
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>เงินต้น <span className="tabular-nums">{money(e.principal.amount)}</span></span>
                          {canWrite && !e.principal.is_derived && <RowActions table="cash_movements" id={e.principal.id} paths={paths}
                            canDelete={canDelete && !(both && group)} extra={wholeDelete} fields={[
                            { name: "movement_date", label: "วันที่", type: "date", value: e.principal.movement_date },
                            { name: "amount", label: "เงินต้น", type: "number", value: e.principal.amount }]} />}
                        </div>
                      )}
                      {e.interest && (
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>ดอกเบี้ย (รายได้) <span className="tabular-nums">{money(e.interest.amount)}</span>
                            {Number(e.interest.tax ?? 0) ? ` · ภาษีหัก ณ ที่จ่าย ${money(e.interest.tax)}` : ""}</span>
                          {canWrite && <RowActions table="income_transactions" id={e.interest.id} paths={paths}
                            canDelete={canDelete && !(both && group)} extra={wholeDelete} fields={loanInterestFields(e.interest)} />}
                        </div>
                      )}
                      {e.disburse && canWrite && !e.disburse.is_derived && (
                        <div className="mt-0.5 text-xs"><RowActions table="cash_movements" id={e.disburse.id} paths={paths} canDelete={canDelete} fields={[
                          { name: "movement_date", label: "วันที่", type: "date", value: e.disburse.movement_date },
                          { name: "amount", label: "จำนวน", type: "number", value: e.disburse.amount }]} /></div>
                      )}
                    </td>
                    <td className="py-2 text-xs text-slate-500">{e.bank ? bankName.get(e.bank) ?? "บัญชี" : ""}</td>
                    <td className={`py-2 text-right tabular-nums ${e.disburse ? "" : "text-emerald-700"}`}>{money(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-slate-500">การรับชำระแต่ละครั้งแสดงเป็นยอดรวม (ตรงกับ Statement) · ข้างในแยก เงินต้น = ลดยอดเงินให้กู้ · ดอกเบี้ย = รายได้</p>
      </section>

    </div>
  );
}

const LOAN_STATUS_OPTIONS: [string, string][] = [["ACTIVE", "ปกติ"], ["AT_RISK", "มีความเสี่ยงไม่ได้คืน"], ["CLOSED", "ปิดแล้ว (ได้คืนครบ)"], ["WRITTEN_OFF", "ตัดหนี้สูญ (มูลค่าเป็น 0)"]];
const LOAN_STATUS_LABEL: Record<string, string> = Object.fromEntries(LOAN_STATUS_OPTIONS);

function Item({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-3" : ""}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{children}</dd>
    </div>
  );
}
