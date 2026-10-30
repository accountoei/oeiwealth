import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { MOVE_LABEL, money, thDate, todayBangkok } from "@/lib/format";
import { DisburseForm, LoanInfoForm, PaymentForm } from "./forms";
import EditButton from "@/components/EditButton";
import ScheduleTable, { type SchedRow } from "./ScheduleTable";
import RowActions from "@/components/RowActions";
import UndoButton from "@/components/UndoButton";
import OwnershipEditor from "@/components/OwnershipEditor";
import { WithStatus } from "@/components/StatusSelect";
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
  const preset = rs === "end" || rs === "payment" || rs === "disburse" || rs === "rate" ? rs : undefined;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: l }, { data: extra }, { data: owners }, { data: moves }, { data: incomes }, { data: banks }, { data: family }, { data: persons }, { data: schedRaw }] = await Promise.all([
    supabase.from("v_loans_status").select("*").eq("asset_id", id).maybeSingle(),
    supabase.from("loan_details").select("borrower_phone,contract_no,purpose,at_risk_amount,risk_assessed_date,risk_note").eq("asset_id", id).is("deleted_at", null).maybeSingle(),
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
  const interest = (incomes ?? []).reduce((s, i) => s + Number(i.amount), 0);
  // ตารางผ่อน: งวดที่ยังไม่ครบ = เลยกำหนด / รับบางส่วน / งวดถัดไป → มีปุ่มบันทึกรับ (เติมยอดคงค้างของงวดให้)
  const sched = (schedRaw as Sched[] | null) ?? [];
  const open = sched.filter((x) => x.status !== "PAID" && x.status !== "WRITTEN_OFF");
  const nextDue = open.find((x) => x.status !== "OVERDUE");
  const overdue = open.filter((x) => x.status === "OVERDUE");
  const overdueAmt = overdue.reduce((s, x) => s + Number(x.total_remaining), 0);
  // ปุ่ม "บันทึกรับชำระ" (ปุ่มเดียว): มีงวดเลยกำหนด → เติมเฉพาะงวดที่เลยกำหนด (ไม่รวมงวดที่ยังไม่ถึง · ตกลง 30 ต.ค. 2026)
  //   ไม่มี → งวดถัดไป · ในหน้าต่าง ยอดเปลี่ยนตาม "วันที่ได้รับ" (งวดที่ครบถึงวันนั้น)
  const payTo = overdue.at(-1) ?? nextDue;
  const dueLines = { lines: open.map((x) => ({ no: x.installment_no, due: x.due_date, p: Number(x.principal_remaining), i: Number(x.interest_remaining) })),
    from: payTo?.due_date ?? today };
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

  // ให้กู้เพิ่ม = เงินที่จ่ายให้ผู้กู้หลังวันยอดตั้งต้น (ไม่นับครั้งแรกของสัญญาที่ให้กู้ในระบบ)
  const disb = (moves ?? []).filter((m) => m.movement_type === "LOAN_DISBURSEMENT" && m.to_asset_id === id && m.movement_date > l.opening_date)
    .sort((a, b) => a.movement_date.localeCompare(b.movement_date));
  const extraLent = disb.slice(Number(l.opening_outstanding_principal ?? 0) > 0 ? 0 : 1).reduce((s, m) => s + Number(m.amount), 0);
  // วงกลมสถานะการชำระเงินต้น: ชำระแล้ว = เงินต้น (+ ให้กู้เพิ่ม) − คงเหลือ (ตัดหนี้สูญ: ส่วนที่เหลือ = ตัดหนี้สูญ)
  const principalAll = Number(l.principal ?? 0) + extraLent;
  const leftP = Math.max(Number(l.outstanding_principal ?? 0), 0);
  const paidP = Math.max(principalAll - leftP, 0);
  const paidPct = principalAll > 0 ? Math.min((paidP / principalAll) * 100, 100) : 0;
  // มีความเสี่ยง: ส่วนที่มีความเสี่ยงไม่ได้คืน (แสดงอย่างเดียว · Net Worth ยังนับเต็มจนตัดหนี้สูญ)
  const riskAmt = l.status === "AT_RISK" && extra?.at_risk_amount != null ? Math.min(Number(extra.at_risk_amount), leftP) : null;
  // แบบการชำระ: ดูจากตารางผ่อน
  const payType = sched.length === 0 ? "ไม่มีตารางผ่อน (รับตามจริง)"
    : sched.length > 1 && sched.slice(0, -1).every((x) => Number(x.principal_due) === 0) ? "รับดอกเบี้ยรายงวด · คืนเงินต้นครั้งเดียวตอนจบ"
    : sched.every((x) => Number(x.interest_due) === 0) ? "ผ่อนเงินต้นรายงวด (ไม่มีดอกเบี้ย)"
    : `ผ่อน${sched.length > 1 && sched.slice(1).every((x, i) => /^\d{4}-\d{2}/.test(x.due_date) && monthGap(sched[i].due_date, x.due_date) === 1) ? "รายเดือน" : "เป็นงวด"} (เงินต้น + ดอกเบี้ย) · ${sched.length} งวด`;
  // งวดที่รับครบ: วันที่รับครบ (เงินต้นสะสมที่รับ ≥ เงินต้นสะสมของงวด และดอกเบี้ยเช่นกัน) · รับก่อนเริ่มใช้ระบบ = null
  const pRecv = (moves ?? []).filter((m) => m.movement_type === "LOAN_PRINCIPAL_RECEIPT").map((m) => ({ d: m.movement_date as string, v: Number(m.amount) }))
    .sort((a, b) => a.d.localeCompare(b.d));
  const iRecv = (incomes ?? []).map((i) => ({ d: i.date as string, v: Number(i.amount) })).sort((a, b) => a.d.localeCompare(b.d));
  const dateWhen = (list: { d: string; v: number }[], base: number, need: number) => {
    if (base >= need - 0.005) return null;
    let t = base;
    for (const e of list) { t += e.v; if (t >= need - 0.005) return e.d; }
    return null;
  };
  let cumP = 0, cumI = 0;
  const pBase = Math.max(principalAll - Number(l.opening_outstanding_principal ?? principalAll), 0);
  const schedRows: SchedRow[] = sched.map((x) => {
    cumP += Number(x.principal_due);
    const preOpening = x.due_date <= l.opening_date;
    if (!preOpening) cumI += Number(x.interest_due);
    const dp = dateWhen(pRecv, pBase, cumP), di = preOpening ? null : dateWhen(iRecv, 0, cumI);
    const st = LOAN_SCHED_STATUS[x.status];
    return {
      id: x.id, no: x.installment_no, due: x.due_date, principal: Number(x.principal_due), interest: Number(x.interest_due), total: Number(x.total_due),
      remaining: Number(x.total_remaining), balance: Math.max(Math.round((schedP - cumP) * 100) / 100, 0), status: x.status, statusText: x.status === "PAID" ? "ชำระแล้ว" : st?.text ?? x.status, statusCls: st?.cls ?? "",
      notes: x.notes, paidOn: x.status === "PAID" ? [dp, di].filter(Boolean).sort().at(-1) ?? null : undefined,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/financial/loans" className="text-sm text-slate-500 hover:underline">← Loans Receivable</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-slate-900">{l.name}</h1>
            <p className="text-sm text-slate-500">ผู้กู้ {l.borrower_name}{extra?.borrower_phone && <> · โทร <a href={`tel:${extra.borrower_phone}`} className="hover:underline">{extra.borrower_phone}</a></>}
              {" · "}{l.currency}{l.derived_status === "OVERDUE" && <span className="text-red-600"> · เลยกำหนดคืน</span>}</p>
          </div>
          <div className="flex items-start gap-2">
            <Link href={`/print/loan/${id}`} target="_blank" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">พิมพ์สัญญา / ตาราง</Link>
            {canWrite && loanOpen && (
              <ActionBar>
                <DisburseForm assetId={id} currency={l.currency} banks={banks ?? []} today={today} minDate={goLive} hasOpenSchedule={open.length > 0} />
              </ActionBar>
            )}
          </div>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        {/* ซ้าย: สถานะการชำระเงินต้น (วงกลม) + เอกสาร */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-medium text-slate-900">สถานะการชำระเงินต้น</h2>
            <div className="flex flex-wrap items-center gap-6">
              <Donut pct={paidPct} label={l.status === "WRITTEN_OFF" ? "ตัดหนี้สูญ" : "ชำระแล้ว"} />
              <dl className="min-w-48 flex-1 divide-y divide-slate-100 text-sm">
                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />ชำระแล้ว</dt>
                  <dd className="text-right tabular-nums"><b>{money(paidP, l.currency, 0)}</b> <span className="ml-2 text-xs text-slate-500">{paidPct.toFixed(1)}%</span></dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-slate-300" />{l.status === "WRITTEN_OFF" ? "ตัดหนี้สูญ" : "คงเหลือ"}</dt>
                  <dd className="text-right tabular-nums"><b>{money(leftP, l.currency, 0)}</b> <span className="ml-2 text-xs text-slate-500">{(100 - paidPct).toFixed(1)}%</span></dd>
                </div>
                {riskAmt != null && (
                  <div className="flex items-center justify-between gap-3 py-2 text-amber-800">
                    <dt className="pl-4.5 text-xs">ในจำนวนนี้ มีความเสี่ยงไม่ได้คืน<div className="text-slate-500">คาดว่าจะได้คืน {money(leftP - riskAmt, l.currency, 0)}{extra?.risk_assessed_date ? ` · ประเมิน ${thDate(extra.risk_assessed_date)}` : ""}</div></dt>
                    <dd className="text-right tabular-nums"><b>{money(riskAmt, l.currency, 0)}</b></dd>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 py-2 font-medium">
                  <dt>รวมเงินต้น{extraLent > 0 && <div className="text-xs font-normal text-slate-500">ตามสัญญา {money(Number(l.principal), undefined, 0)} + ให้กู้เพิ่ม {money(extraLent, undefined, 0)}</div>}</dt>
                  <dd className="text-right tabular-nums">{money(principalAll, l.currency, 0)} <span className="ml-2 text-xs text-slate-500">100%</span></dd>
                </div>
              </dl>
            </div>
            <p className="mt-3 text-xs text-slate-500">ดอกเบี้ยรับแล้ว (รายได้) {money(interest, l.currency)}{l.status === "WRITTEN_OFF" ? " · ตัดหนี้สูญแล้ว มูลค่าใน Net Worth = 0" : ""}
              {riskAmt != null ? ` · ส่วนที่มีความเสี่ยงยังนับเต็มใน Net Worth จนกว่าจะตัดหนี้สูญ${extra?.risk_note ? ` · ${extra.risk_note}` : ""}` : ""}</p>
            {l.status === "CLOSED" && leftP > 0.005 && (
              <p className="mt-2 text-xs text-red-600">สถานะ &ldquo;ปิดแล้ว&rdquo; แต่ยังมีเงินต้นคงเหลือ — เปลี่ยนสถานะกลับเป็น &ldquo;ปกติ&rdquo; แล้วบันทึกรับชำระให้ครบ หรือเลือก &ldquo;ตัดหนี้สูญ&rdquo; (ยอดนี้ยังนับใน Net Worth)</p>
            )}
          </div>
          <div className="flex flex-1 flex-col">
            <EntityDocuments category="LOAN" entityType="ASSET" entityId={id} module="FINANCIAL" role={me.role} paths={paths} fill />
          </div>
        </div>
        {/* ขวา: รายละเอียด (ปุ่มแก้ไขอยู่ในกล่อง) */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h2 className="font-medium text-slate-900">รายละเอียด</h2>
            {canWrite && (
              <EditButton title="แก้ไขรายละเอียด" small>
                <div className="space-y-5">
                  <p className="text-xs text-slate-500">วันที่ให้กู้และยอดตั้งต้นแก้ไม่ได้ (ผูกกับรายการเงินที่บันทึกแล้ว)</p>
                  <WithStatus status={{ table: "loan_details", id: l.id, value: l.status, paths, label: "สถานะ",
                    options: LOAN_STATUS_OPTIONS,
                    remove: canDelete ? { kind: "asset", id, redirectTo: "/financial/loans", paths: ["/financial/loans"], label: "ลบรายการนี้", hint: "ลบได้เมื่อไม่มีรายการให้กู้ / รับชำระ" } : undefined }}>
                    <LoanInfoForm assetId={id} minDue={sched.at(-1)?.due_date ?? null} hasOpenSchedule={open.length > 0}
                      risk={l.status === "AT_RISK" ? { outstanding: leftP, currency: l.currency, today, date: extra?.risk_assessed_date ?? null, note: extra?.risk_note ?? null,
                        expected: extra?.at_risk_amount == null ? null : Math.max(leftP - Number(extra.at_risk_amount), 0) } : undefined} v={{ name: l.name, borrower_name: l.borrower_name, interest_rate: l.interest_rate == null ? null : Number(l.interest_rate), due_date: l.due_date, notes: l.notes,
                      borrower_phone: extra?.borrower_phone ?? null, contract_no: extra?.contract_no ?? null, purpose: extra?.purpose ?? null }} />
                  </WithStatus>
                  <div className="border-t border-slate-100 pt-4">
                    <h3 className="mb-2 text-sm font-medium text-slate-800">ผู้ให้กู้ (เจ้าของ)</h3>
                    <ul className="mb-2 space-y-0.5 text-sm">{activeOwners.map((o) => <li key={o.person_id}>{o.person_name} · {Number(o.ownership_percent)}%</li>)}</ul>
                    <OwnershipEditor kind="asset" id={id} persons={persons ?? []} paths={paths} today={today} startOpen
                      current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent) }))} />
                  </div>
                </div>
              </EditButton>
            )}
          </div>
          <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2.5 text-sm">
            <dt className="text-slate-500">เลขที่สัญญา</dt><dd>{extra?.contract_no || <span className="text-slate-400">—</span>}</dd>
            <dt className="text-slate-500">วันที่ทำสัญญา</dt><dd>{l.loan_date ? thDate(l.loan_date) : <span className="text-slate-400">—</span>}</dd>
            <dt className="text-slate-500">วัตถุประสงค์</dt><dd>{extra?.purpose || <span className="text-slate-400">—</span>}</dd>
            <dt className="text-slate-500">เงินต้นเริ่มต้น</dt><dd className="font-medium tabular-nums">{money(l.principal, l.currency)}</dd>
            <dt className="text-slate-500">อัตราดอกเบี้ย</dt><dd>{l.interest_rate != null ? `${Number(l.interest_rate)}% ต่อปี` : <span className="text-slate-400">—</span>}</dd>
            <dt className="text-slate-500">แบบการชำระ</dt><dd>{payType}</dd>
            <dt className="text-slate-500">วันครบกำหนด</dt><dd>{l.due_date ? thDate(l.due_date) : <span className="text-slate-400">—</span>}</dd>
            <dt className="text-slate-500">สถานะ</dt><dd><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLS[l.status] ?? "bg-slate-100 text-slate-700"}`}>● {LOAN_STATUS_LABEL[l.status] ?? l.status}</span></dd>
            <dt className="text-slate-500">ผู้กู้</dt><dd>{l.borrower_name}{extra?.borrower_phone && <div className="text-xs text-slate-500">โทร {extra.borrower_phone}</div>}</dd>
            <dt className="text-slate-500">ผู้ให้กู้ (เจ้าของ)</dt><dd>
              {activeOwners.length === 0 ? "-" : activeOwners.map((o) => `${o.person_name} ${Number(o.ownership_percent)}%`).join(", ")}
              {ownerTotal < 100 && <div className="text-xs text-amber-700">ยังไม่ระบุเจ้าของ {100 - ownerTotal}%</div>}</dd>
            <dt className="text-slate-500">ยอดตั้งต้น</dt><dd className="tabular-nums">{money(l.opening_outstanding_principal, l.currency)} <span className="text-xs text-slate-500">ณ {thDate(l.opening_date)}</span></dd>
            <dt className="text-slate-500">หมายเหตุ</dt><dd className="whitespace-pre-line">{l.notes || <span className="text-slate-400">—</span>}</dd>
          </dl>
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
            {sched.length > 0 && Math.abs(schedP - principalAll) > 0.01 && (
              <p className="mt-0.5 text-xs text-amber-700">เงินต้นตามตาราง ({money(schedP)}) ไม่เท่ากับเงินต้นของสัญญา{extraLent > 0 ? " รวมที่ให้กู้เพิ่ม" : ""} ({money(principalAll)})
                {extraLent > 0 ? " — กด “คำนวณงวดที่เหลือใหม่” เพื่อใส่ยอดที่ให้กู้เพิ่มในตาราง" : " — สถานะ “รับแล้ว” อาจคลาดเคลื่อน"}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
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
                firstDue: addMonthsKeepDay(l.loan_date ?? today, 1), lastDue: l.due_date ?? undefined }} />
          )}
          {canWrite && loanOpen && (payTo ? (
            <PaymentForm assetId={id} currency={l.currency} banks={banks ?? []} today={today} minDate={goLive} outstanding={leftP}
              title={`${overdue.length > 1 ? `รับชำระงวดที่เลยกำหนด (งวดที่ ${overdue[0].installment_no}–${payTo.installment_no})`
                : `รับชำระงวดที่ ${payTo.installment_no} (ครบ ${thDate(payTo.due_date)})`} · เงินที่รับตัดงวดที่ค้างเรียงจากงวดเก่าก่อน`}
              due={dueLines} />
          ) : (
            <PaymentForm assetId={id} currency={l.currency} banks={banks ?? []} today={today} minDate={goLive} outstanding={leftP}
              interestOwed={sched.length ? interestOwedUpTo(today) : undefined} principalDue={sched.length ? principalDueUpTo(today) : undefined} />
          ))}
          </div>
        </div>
        {sched.length > 0 && <ScheduleTable rows={schedRows} currency={l.currency} />}
        {sched.length > 0 && <p className="text-xs text-slate-500">
          ปุ่ม &ldquo;บันทึกรับชำระ&rdquo; ด้านบนตารางเติมยอดงวดที่เลยกำหนด (ไม่มี = งวดถัดไป) ให้ · เปลี่ยนวันที่ได้รับ = ยอดเปลี่ยนตามงวดที่ครบถึงวันนั้น · แก้ยอดได้ตามที่รับจริง ·
          ลบการรับชำระที่บันทึกผิดได้ที่ประวัติด้านล่าง (ตารางกลับเป็นเหมือนเดิม) · เพิ่ม / แก้งวดใช้ &ldquo;{hasPayments ? "คำนวณงวดที่เหลือใหม่" : "ตั้ง / แก้ตารางผ่อน"}&rdquo; ·
          สถานะคิดจากยอดที่รับจริง: เงินที่รับตัดงวดที่ค้างเรียงจากงวดเก่าก่อน · ดอกเบี้ยนับเฉพาะงวดหลังวันยอดตั้งต้น ({thDate(l.opening_date)}) ·
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
const STATUS_CLS: Record<string, string> = { ACTIVE: "bg-emerald-50 text-emerald-700", AT_RISK: "bg-amber-50 text-amber-800",
  CLOSED: "bg-slate-100 text-slate-600", WRITTEN_OFF: "bg-slate-200 text-slate-700" };
const monthGap = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/** วงกลมสัดส่วน (% ตรงกลาง) */
function Donut({ pct, label }: { pct: number; label: string }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img" aria-label={`${label} ${pct.toFixed(1)}%`}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="#e2e8f0" strokeWidth="18" />
      <circle cx="70" cy="70" r={r} fill="none" stroke="#2563eb" strokeWidth="18" strokeDasharray={`${(c * pct) / 100} ${c}`}
        transform="rotate(-90 70 70)" />
      <text x="70" y="70" textAnchor="middle" fontSize="20" fontWeight="700" fill="#0f172a">{pct.toFixed(1)}%</text>
      <text x="70" y="90" textAnchor="middle" fontSize="11" fill="#64748b">{label}</text>
    </svg>
  );
}
