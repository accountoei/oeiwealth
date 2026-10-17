import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ACCOUNT_TYPE_LABEL, bankLabel, money, monthOptions, monthRange, thDate, thMonth, todayBangkok } from "@/lib/format";
import MonthPicker from "@/components/MonthPicker";
import MovesView, { type MoveRow, type StmtRow } from "../../../income-expenses/MovesView";
import { moveMeta } from "@/lib/ledger";
import TransferEditor from "../../../income-expenses/TransferEditor";
import { AccountNoPanel, EditInfoForm, SettleLatestButton, UpdateBalanceForm } from "./forms";
import RowActions from "@/components/RowActions";
import OwnershipEditor from "@/components/OwnershipEditor";
import DeleteEntity from "@/components/DeleteEntity";
import StatusSelect from "@/components/StatusSelect";
import EntityDocuments from "@/components/docs/EntityDocuments";

const SOURCE_LABEL: Record<string, string> = {
  OPENING: "ยอดตั้งต้น", ACCOUNT_SETUP: "เปิดบัญชีในระบบ", BALANCE_UPDATE: "อัปเดตยอด",
  RECONCILIATION: "อัปเดตยอดสิ้นเดือน", STATEMENT: "Statement", USER: "ผู้ใช้", APPRAISAL: "ประเมิน",
};
const MOVE_LABEL: Record<string, string> = {
  INCOME: "รายได้", EXPENSE: "ค่าใช้จ่าย", TRANSFER: "โอน", FX_EXCHANGE: "แลกเงิน", INVESTMENT_OUT: "โอนเข้าพอร์ต",
  INVESTMENT_IN: "รับจากพอร์ต", LOAN_DISBURSEMENT: "ให้กู้", LOAN_PRINCIPAL_RECEIPT: "รับชำระเงินกู้",
  ASSET_PURCHASE: "ซื้อทรัพย์สิน", ASSET_SALE: "ขายทรัพย์สิน", CARD_PAYMENT: "จ่ายบัตรเครดิต",
  LIABILITY_PAYMENT: "จ่ายหนี้", SECURITY_DEPOSIT_IN: "รับเงินประกัน", SECURITY_DEPOSIT_OUT: "คืนเงินประกัน",
  REIMBURSEMENT_IN: "เงินคืนค่าใช้จ่าย", OTHER_IN: "เงินเข้าอื่น ๆ", OTHER_OUT: "เงินออกอื่น ๆ",
};

export default async function AccountDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ m?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const today = todayBangkok();
  const ym = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? (sp.m as string) : today.slice(0, 7);
  const { start, end } = monthRange(ym);
  const dayBefore = new Date(Date.parse(`${start}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const [{ data: acc }, { data: bal }, { data: owners }, { data: vals }, { data: moves }, { data: family }, { data: persons }] = await Promise.all([
    supabase.from("v_bank_accounts_safe").select("*").eq("asset_id", id).maybeSingle(),
    supabase.from("v_bank_balance_current").select("*").eq("asset_id", id).maybeSingle(),
    supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", id),
    supabase.from("asset_valuations").select("id,valuation_date,value,source,notes")
      .eq("asset_id", id).is("deleted_at", null).order("valuation_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("cash_movements").select("id,movement_date,movement_type,from_asset_id,to_asset_id,to_credit_card_id,to_liability_id,amount,fee,counter_amount,counter_currency,description,is_derived,source_entity_type,source_entity_id,movement_group_id,created_at")
      .or(`from_asset_id.eq.${id},to_asset_id.eq.${id}`).is("deleted_at", null)
      .gte("movement_date", start).lte("movement_date", end)
      .order("movement_date", { ascending: true }).order("created_at", { ascending: true }),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
  ]);
  if (!acc) notFound();
  // ---------------------------------------------------------------- รายการเดือนนี้ + ยอดคงเหลือหลังแต่ละรายการ
  const expIds = (moves ?? []).filter((m) => m.source_entity_type === "EXPENSE" && m.source_entity_id).map((m) => m.source_entity_id as string);
  const incIds = (moves ?? []).filter((m) => m.source_entity_type === "INCOME" && m.source_entity_id).map((m) => m.source_entity_id as string);
  const otherIds = [...new Set((moves ?? []).flatMap((m) => [m.from_asset_id, m.to_asset_id]).filter((x): x is string => !!x && x !== id))];
  const cardIds = [...new Set((moves ?? []).map((m) => m.to_credit_card_id).filter((x): x is string => !!x))];
  const liabIds = [...new Set((moves ?? []).map((m) => m.to_liability_id).filter((x): x is string => !!x))];
  const none = Promise.resolve({ data: [] as never[] });
  const [{ data: openRaw }, { data: expMeta }, { data: incMeta }, { data: banksAll }, { data: others }, { data: cardsMeta }, { data: liabsMeta }] = await Promise.all([
    supabase.rpc("bank_balances_at", { p_date: dayBefore }),
    expIds.length ? supabase.from("expense_items").select("id,expense_category,pending_split").in("id", expIds) : none,
    incIds.length ? supabase.from("income_transactions").select("id,income_type,income_subtype,pending_split").in("id", incIds) : none,
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,bank_name,account_no_masked,status"),
    otherIds.length ? supabase.from("assets").select("id,name").in("id", otherIds) : none,
    cardIds.length ? supabase.from("credit_cards").select("id,issuer,card_name,card_last4").in("id", cardIds) : none,
    liabIds.length ? supabase.from("liabilities").select("id,name").in("id", liabIds) : none,
  ]);
  const opening = ((openRaw as { asset_id: string; calculated: number | null }[] | null) ?? []).find((r) => r.asset_id === id)?.calculated;
  const expBy = new Map((expMeta ?? []).map((e) => [e.id as string, e]));
  const incBy = new Map((incMeta ?? []).map((e) => [e.id as string, e]));
  const bankBy = new Map((banksAll ?? []).map((b) => [b.asset_id as string, b]));
  const otherBy = new Map((others ?? []).map((a) => [a.id as string, a.name as string]));
  const cardBy = new Map((cardsMeta ?? []).map((c) => [c.id as string, [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ")]));
  const liabBy = new Map((liabsMeta ?? []).map((l) => [l.id as string, l.name as string]));
  const acctLabel = (aid: string | null) => {
    if (!aid) return "ภายนอก";
    const b = bankBy.get(aid);
    if (b) return `${bankLabel(b.bank_name as string).replace(/^.*\((.*)\)$/, "$1")} ${b.account_no_masked ? String(b.account_no_masked).replace(/^.*?(\d{4})$/, "••$1") : b.name}`;
    return otherBy.get(aid) ?? "ทรัพย์สิน";
  };
  // สถานะยอดล่าสุด (คำนวณสดทุกครั้ง): ก้อนรอแยกของเดือน · ส่วนต่างที่ยังไม่ลงก้อน
  const { data: stRaw } = await supabase.rpc("bank_statement_status", { p_asset_id: id });
  const st = stRaw as { latest_date: string; lump: number | null; lump_date: string | null; difference: number } | null;

  const canEdit = me.role === "ADMIN" || me.role === "EDITOR";
  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const paths = [`/financial/cash/${id}`, "/financial/cash", "/income-expenses"];
  const activeOwners = (owners ?? []).filter((o) => !o.end_date);
  // รับชำระเงินให้กู้ครั้งเดียว (เงินต้น + ดอกเบี้ย) = 2 รายการในระบบ → แสดงรวมเป็น 1 แถว ให้ตรงกับ Statement
  type Mv = NonNullable<typeof moves>[number];
  type Row = Mv & { parts?: Mv[] };
  const rows: Row[] = [];
  const byGroup = new Map<string, Row>();
  (moves ?? []).forEach((m) => {
    const g = m.movement_group_id;
    const merged = g ? byGroup.get(g) : undefined;
    if (merged && merged.to_asset_id === id && m.to_asset_id === id) {
      merged.parts = [...(merged.parts ?? [merged]), m];
      merged.amount = Number(merged.amount) + Number(m.amount);
      return;
    }
    const r: Row = { ...m };
    rows.push(r);
    if (g) byGroup.set(g, r);
  });
  const partLabel = (m: Mv) => (m.movement_type === "LOAN_PRINCIPAL_RECEIPT" ? "เงินต้น" : m.movement_type === "INCOME" ? "ดอกเบี้ย" : MOVE_LABEL[m.movement_type] ?? m.movement_type);
  const loanOf = (r: Row) => (r.parts ?? [r]).find((x) => x.movement_type === "LOAN_PRINCIPAL_RECEIPT")?.from_asset_id;
  const ownerTotal = activeOwners.reduce((s, o) => s + Number(o.ownership_percent), 0);

  // เรียงตามเวลา: รายการของวัน → ยอดตาม Statement ของวันนั้น (เป็นยอดสิ้นวัน · ใช้เป็นจุดตั้งต้นใหม่)
  type Line = { key: string; date: string; kind: "move"; row: Row; inAmt: number | null; outAmt: number | null; balance: number | null;
    meta: ReturnType<typeof moveMeta>; detail: string; sub: string | null }
    | { key: string; date: string; kind: "stmt"; value: number; balance: number; diff: number | null; source: string };
  const monthVals = (vals ?? []).filter((v) => v.valuation_date >= start && v.valuation_date <= end)
    .sort((a, b) => a.valuation_date.localeCompare(b.valuation_date));
  const lines: Line[] = [];
  let run: number | null = opening == null ? null : Number(opening);
  let sumIn = 0, sumOut = 0;
  const pushStmts = (upto: string | null) => {
    while (monthVals.length && (upto === null || monthVals[0].valuation_date < upto)) {
      const v = monthVals.shift()!;
      const diff = run == null ? null : Math.round((Number(v.value) - run) * 100) / 100;
      run = Number(v.value);
      lines.push({ key: `v${v.id}`, date: v.valuation_date, kind: "stmt", value: Number(v.value), balance: run,
        diff: diff != null && Math.abs(diff) >= 0.005 ? diff : null, source: SOURCE_LABEL[v.source] ?? v.source });
    }
  };
  for (const r of rows) {
    pushStmts(r.movement_date);
    const isIn = r.to_asset_id === id;
    const inAmt = isIn ? Number(r.counter_currency ? r.counter_amount ?? 0 : r.amount) : null;
    const outAmt = !isIn ? Number(r.amount) + Number(r.fee ?? 0) : null;
    if (run != null) run = run + (inAmt ?? 0) - (outAmt ?? 0);
    sumIn += inAmt ?? 0; sumOut += outAmt ?? 0;
    const e = r.source_entity_type === "EXPENSE" && r.source_entity_id ? expBy.get(r.source_entity_id) : undefined;
    const inc = r.source_entity_type === "INCOME" && r.source_entity_id ? incBy.get(r.source_entity_id) : undefined;
    const meta = moveMeta(r.movement_type, isIn ? "in" : "out", { merged: !!r.parts, incomeType: inc?.income_type, incomeSubtype: inc?.income_subtype,
      expenseCategory: e?.expense_category, pending: !!(e?.pending_split || inc?.pending_split) });
    const other = isIn ? r.from_asset_id : r.to_asset_id;
    const detail = r.parts ? "รับชำระเงินให้กู้"
      : ["TRANSFER", "FX_EXCHANGE"].includes(r.movement_type) ? `${isIn ? "รับเงินจาก" : "โอนไป"} ${acctLabel(other)}`
      : r.movement_type === "CARD_PAYMENT" ? `จ่ายบัตร ${cardBy.get(r.to_credit_card_id ?? "") ?? ""}`
      : r.movement_type === "LIABILITY_PAYMENT" ? `จ่ายหนี้ ${liabBy.get(r.to_liability_id ?? "") ?? ""}`
      : ["INVESTMENT_OUT", "INVESTMENT_IN", "LOAN_DISBURSEMENT", "ASSET_PURCHASE", "ASSET_SALE"].includes(r.movement_type)
        ? `${r.description ?? meta.label}` : r.description ?? meta.label;
    const sub = r.parts ? r.parts.map((x) => `${partLabel(x)} ${money(x.amount)}`).join(" + ")
      : ["TRANSFER", "FX_EXCHANGE", "CARD_PAYMENT", "LIABILITY_PAYMENT"].includes(r.movement_type) && r.description && r.description !== detail ? r.description : null;
    lines.push({ key: r.id, date: r.movement_date, kind: "move", row: r, inAmt, outAmt, balance: run, meta, detail, sub });
  }
  pushStmts(null);
  const closing = run;
  const months = monthOptions(family?.go_live_date, today, 0, ym);
  const sameCcyBanks = (banksAll ?? []).filter((b) => b.currency === acc.currency && b.status === "ACTIVE")
    .map((b) => ({ asset_id: b.asset_id as string, name: b.name as string }));
  // ตารางแบบเดียวกับแท็บเงินเข้า–ออก (MovesView) · rows ส่งแบบใหม่ → เก่า
  const ledgerStmts: StmtRow[] = (vals ?? []).filter((v) => v.valuation_date >= start && v.valuation_date <= end)
    .map((v) => ({ key: `v${v.id}`, date: v.valuation_date, value: Number(v.value), label: SOURCE_LABEL[v.source] ?? v.source }));
  const ledgerRows: MoveRow[] = lines.filter((l) => l.kind === "move").reverse().map((l) => {
    const m = (l as Extract<Line, { kind: "move" }>).row;
    const e = m.source_entity_type === "EXPENSE" && m.source_entity_id ? expBy.get(m.source_entity_id) : undefined;
    const inc = m.source_entity_type === "INCOME" && m.source_entity_id ? incBy.get(m.source_entity_id) : undefined;
    const isIn = m.to_asset_id === id;
    const pfLink = ["INVESTMENT_OUT", "INVESTMENT_IN"].includes(m.movement_type) && m.counter_currency
      ? (m.movement_type === "INVESTMENT_OUT" ? m.to_asset_id : m.from_asset_id) : null;
    const bankPair = m.movement_type === "TRANSFER" && m.from_asset_id && m.to_asset_id && bankBy.has(m.from_asset_id) && bankBy.has(m.to_asset_id) && !m.counter_currency;
    const actions = m.parts && loanOf(m) ? <Link href={`/financial/loans/${loanOf(m)}`} className="text-xs text-slate-500 underline">แก้ที่หน้าเงินให้กู้</Link>
      : pfLink ? <Link href={`/investments/${pfLink}`} className="text-xs text-slate-500 underline">แก้ที่หน้าพอร์ต</Link>
      : m.is_derived ? <span className="text-xs text-slate-400">แก้ที่ต้นทาง</span>
      : !canWrite || ["INCOME", "EXPENSE", "REIMBURSEMENT_IN", "SECURITY_DEPOSIT_OUT", "LOAN_PRINCIPAL_RECEIPT"].includes(m.movement_type) ? null
      : <RowActions table="cash_movements" id={m.id} paths={paths} canDelete={canDelete}
          editor={bankPair ? <TransferEditor id={m.id} banks={sameCcyBanks}
            values={{ from: m.from_asset_id as string, to: m.to_asset_id as string, date: m.movement_date, amount: Number(m.amount),
              fee: m.fee == null ? null : Number(m.fee), description: m.description }} /> : undefined}
          fields={[{ name: "movement_date", label: "วันที่", type: "date", value: m.movement_date },
            { name: "amount", label: "จำนวน", type: "number", value: m.amount },
            { name: "description", label: "รายละเอียด", value: m.description, width: "w-40" }]} />;
    const ll = l as Extract<Line, { kind: "move" }>;
    return {
      key: m.id, date: m.movement_date, type: m.movement_type, fromLabel: "", toLabel: "",
      fromBank: isIn ? null : id, toBank: isIn ? id : null,
      fromAmount: Number(m.amount), fromCcy: acc.currency, toAmount: ll.inAmt ?? 0, toCcy: acc.currency, fee: Number(m.fee ?? 0),
      detail: ll.detail, sub: ll.sub ? <div className="text-xs text-slate-400">{ll.sub}</div> : undefined,
      extra: Number(m.fee ?? 0) > 0 ? <div className="text-xs text-slate-500">ค่าธรรมเนียม {money(m.fee)}</div> : undefined,
      actions, kind: m.movement_type, merged: !!m.parts,
      metaOpts: { incomeType: inc?.income_type ?? null, incomeSubtype: inc?.income_subtype ?? null,
        expenseCategory: e?.expense_category ?? null, pending: !!(e?.pending_split || inc?.pending_split) },
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/financial/cash" className="text-sm text-slate-500 hover:underline">← Cash &amp; Bank Accounts</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{acc.name}</h1>
        <p className="text-sm text-slate-500">
          {bankLabel(acc.bank_name)} · {ACCOUNT_TYPE_LABEL[acc.account_type] ?? acc.account_type} · {acc.currency}
          {acc.account_no_masked && ` · ${acc.account_no_masked}`}
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">ยอดคงเหลือ (คำนวณ ณ วันนี้)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{money(bal?.calculated_balance, acc.currency)}</div>
          <div className={`mt-1 text-xs ${bal?.balance_label === "CALCULATED" ? "text-amber-700" : "text-emerald-700"}`}>
            {bal?.balance_label === "CALCULATED" ? "มีรายการหลังวันที่ยืนยันยอด" : "ตรงกับยอดที่ยืนยันล่าสุด"}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">ยอดที่ยืนยันล่าสุด</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{money(bal?.confirmed_balance, acc.currency)}</div>
          <div className="mt-1 text-xs text-slate-500">ณ {thDate(bal?.confirmed_date)}</div>
          {st?.lump != null && Math.abs(Number(st.lump)) >= 0.005 && (
            <div className="mt-1 text-xs font-medium text-amber-700">
              <Link href={`/income-expenses?tab=${Number(st.lump) > 0 ? "expense&et" : "income&it"}=recorded&m=${(st.lump_date ?? st.latest_date).slice(0, 7)}`}
                className="hover:underline">
                มี{Number(st.lump) > 0 ? "ค่าใช้จ่าย" : "รายได้"}รอแยกรายละเอียด {thMonth(`${(st.lump_date ?? st.latest_date).slice(0, 7)}-01`)} {money(Math.abs(Number(st.lump)), acc.currency)} → ไปแยก
              </Link>
            </div>
          )}
          {st && Math.abs(Number(st.difference)) >= 0.005 && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-700">
              <span>ยอดล่าสุดไม่ตรงกับรายการที่บันทึก {money(st.difference, acc.currency)}</span>
              {canWrite && <SettleLatestButton assetId={id} />}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">เจ้าของบัญชี</div>
          <ul className="mt-1 space-y-0.5 text-sm">
            {activeOwners.map((o) => <li key={o.person_name}>{o.person_name} · {Number(o.ownership_percent)}%</li>)}
          </ul>
          {ownerTotal < 100 && <div className="mt-1 text-xs text-amber-700">ยังไม่ระบุเจ้าของ {100 - ownerTotal}%</div>}
          {canWrite && <OwnershipEditor kind="asset" id={id} persons={persons ?? []} paths={paths} today={todayBangkok()}
            current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent) }))} />}
        </div>
      </section>

      {canWrite && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium text-slate-900">อัปเดตยอดคงเหลือ</h2>
          <p className="mb-3 text-xs text-slate-500">
            กรอกยอดจริงจากแอปธนาคาร / Statement · ส่วนต่างลงก้อน &ldquo;รอแยกรายละเอียด&rdquo; ให้อัตโนมัติ · หลายบัญชีพร้อมกันได้ที่แท็บ &ldquo;อัปเดตยอดคงเหลือ&rdquo; ในหน้า Cash
          </p>
          <UpdateBalanceForm assetId={id} currency={acc.currency} today={todayBangkok()} minDate={family?.go_live_date ?? ""} />
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-slate-900">เลขบัญชี</h2>
        <AccountNoPanel assetId={id} bankAccountId={acc.id} masked={acc.account_no_masked}
          canReveal={canEdit} canSet={canWrite} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-slate-900">ประวัติยอดที่ยืนยัน</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="py-1">วันที่</th><th className="text-right">ยอด</th><th className="pl-4">ที่มา</th>
              <th className="pl-4">หมายเหตุ</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(vals ?? []).map((v) => (
              <tr key={v.id}>
                <td className="py-1.5">{thDate(v.valuation_date)}</td>
                <td className="text-right tabular-nums">{money(v.value)}</td>
                <td className="pl-4">{SOURCE_LABEL[v.source] ?? v.source}</td>
                <td className="pl-4 text-slate-500">{v.notes}</td>
                <td className="pl-2 text-right">
                  {canWrite && v.source !== "RECONCILIATION" && (
                    <RowActions table="asset_valuations" id={v.id} paths={paths} canDelete={canDelete && (vals ?? []).length > 1}
                      fields={[{ name: "valuation_date", label: "วันที่", type: "date", value: v.valuation_date },
                        { name: "value", label: "ยอด", type: "number", value: v.value },
                        { name: "notes", label: "หมายเหตุ", value: v.notes, width: "w-40" }]} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium text-slate-900">รายการเงินเข้า–ออก {thMonth(start)}</h2>
          <MonthPicker months={months} value={ym} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="text-emerald-700">เงินเข้า <b className="tabular-nums">+{money(sumIn)}</b></span>
          <span className="text-red-700">เงินออก <b className="tabular-nums">−{money(sumOut)}</b></span>
          <span className="text-slate-600">ยอด{end < today ? "สิ้นเดือน" : "ล่าสุด"} <b className="tabular-nums">{closing == null ? "-" : money(closing, acc.currency)}</b></span>
        </div>
        <p className="mb-3 mt-1 text-xs text-slate-500">รายการเกิดจากการบันทึกรายได้ ค่าใช้จ่าย การโอน และการลงทุนในหน้าที่เกี่ยวข้อง · ยอดคงเหลือ = ยอดยกมา / ยอดตาม Statement + รายการหลังจากนั้น · กดที่แถวเพื่อแก้ / ลบ</p>
        <MovesView rows={ledgerRows} banks={[]} showActions={canWrite} fixedAcct={id}
          openings={{ [id]: opening == null ? null : Number(opening) }} statements={{ [id]: ledgerStmts }} monthStart={start} />
      </section>

      {canWrite && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-1 font-medium text-slate-900">แก้ไขข้อมูลบัญชี</h2>
          <p className="mb-3 text-xs text-slate-500">แก้เฉพาะข้อมูลบัญชี ไม่กระทบยอดเงิน</p>
          <EditInfoForm acc={acc} />
          <div className="mt-4 border-t border-slate-100 pt-3">
            <StatusSelect table="assets" id={id} value={acc.status} paths={paths}
              options={[["ACTIVE", "ใช้งาน"], ["CLOSED", "ปิดบัญชีแล้ว"]]} label="สถานะบัญชี" />
          </div>
          {canDelete && <div className="mt-4 border-t border-slate-100 pt-3">
            <DeleteEntity kind="asset" id={id} redirectTo="/financial/cash" paths={["/financial/cash"]} label="ลบบัญชีนี้"
              hint="ลบได้เมื่อไม่มีรายการเงินเข้าออกผูกอยู่ · ปิดบัญชีจริงให้เปลี่ยนสถานะในแก้ไขข้อมูล" />
          </div>}
        </section>
      )}
      <EntityDocuments entityType="ASSET" entityId={id} module="FINANCIAL" role={me.role} paths={paths} />
    </div>
  );
}
