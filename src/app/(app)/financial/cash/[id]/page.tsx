import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ACCOUNT_TYPE_LABEL, bankLabel, money, monthOptions, monthRange, thDate, thMonth, todayBangkok } from "@/lib/format";
import MonthPicker from "@/components/MonthPicker";
import MovesView, { type StmtRow } from "../../../income-expenses/MovesView";
import { moveMeta, stripPending } from "@/lib/ledger";
import { MOVE_SELECT, makeEntryKit, type Move } from "../../../income-expenses/entry-kit";
import { loadKitCtx } from "../../../income-expenses/entry-kit-load";
import { AccountNoPanel, EditInfoForm, SettleLatestButton, UpdateBalanceForm } from "./forms";
import EditButton from "@/components/EditButton";
import RowActions from "@/components/RowActions";
import OwnershipEditor from "@/components/OwnershipEditor";
import StatusSelect from "@/components/StatusSelect";
import EntityDocuments from "@/components/docs/EntityDocuments";
import { DetailItem as Item } from "@/components/Boxes";

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
  const [{ data: acc }, { data: owners }, { data: vals }, { data: moves }, { data: family }, { data: persons }] = await Promise.all([
    supabase.from("v_bank_accounts_safe").select("*").eq("asset_id", id).maybeSingle(),
    supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", id),
    supabase.from("asset_valuations").select("id,valuation_date,value,source,notes")
      .eq("asset_id", id).is("deleted_at", null).order("valuation_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("cash_movements").select(`${MOVE_SELECT},created_at`)
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
  const prevEnd = new Date(Date.parse(`${today.slice(0, 7)}-01T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const [{ data: stRaw }, { data: nowRaw }, { data: prevRaw }] = await Promise.all([
    supabase.rpc("bank_statement_status", { p_asset_id: id }),
    supabase.rpc("bank_balances_at", { p_date: today }),
    supabase.rpc("bank_balances_at", { p_date: prevEnd }),
  ]);
  type At = { asset_id: string; calculated: number | null };
  const balNow = ((nowRaw as At[] | null) ?? []).find((r) => r.asset_id === id)?.calculated ?? null;
  const balPrev = ((prevRaw as At[] | null) ?? []).find((r) => r.asset_id === id)?.calculated ?? null;
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
      merged.base_amount = Number(merged.base_amount ?? 0) + Number(m.base_amount ?? 0);
      return;
    }
    const r: Row = { ...m };
    rows.push(r);
    if (g) byGroup.set(g, r);
  });
  const partLabel = (m: Mv) => (m.movement_type === "LOAN_PRINCIPAL_RECEIPT" ? "เงินต้น" : m.movement_type === "INCOME" ? "ดอกเบี้ย" : MOVE_LABEL[m.movement_type] ?? m.movement_type);
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
        ? `${r.description ?? meta.label}` : (meta.pending ? stripPending(r.description) : r.description) || meta.label;
    const sub = r.parts ? r.parts.map((x) => `${partLabel(x)} ${money(x.amount)}`).join(" + ")
      : ["TRANSFER", "FX_EXCHANGE", "CARD_PAYMENT", "LIABILITY_PAYMENT"].includes(r.movement_type) && r.description && r.description !== detail ? r.description : null;
    lines.push({ key: r.id, date: r.movement_date, kind: "move", row: r, inAmt, outAmt, balance: run, meta, detail, sub });
  }
  pushStmts(null);
  const closing = run;
  // ประวัติยอดที่ยืนยัน: เฉพาะเดือนที่เลือก (ใหม่ → เก่า) · ไม่มี = บอกยอดล่าสุดก่อนหน้า
  const monthHist = (vals ?? []).filter((v) => v.valuation_date >= start && v.valuation_date <= end);
  const lastVal = (vals ?? []).find((v) => v.valuation_date <= end);
  const months = monthOptions(family?.go_live_date, today, 0, ym);
  // ตารางแบบเดียวกับกล่องเงินเข้า–ออกในหน้า Income & Expenses (ชุดคำสั่งกลาง entry-kit) · rows ส่งแบบใหม่ → เก่า
  const ledgerStmts: StmtRow[] = (vals ?? []).filter((v) => v.valuation_date >= start && v.valuation_date <= end)
    .map((v) => ({ key: `v${v.id}`, date: v.valuation_date, value: Number(v.value), label: SOURCE_LABEL[v.source] ?? v.source }));
  const kit = makeEntryKit(await loadKitCtx(supabase, (moves ?? []) as Move[], { ym, personId: "", canWrite, canDelete, paths }));
  const ledgerRows = kit.buildMoveRows([...((moves ?? []) as Move[])].reverse(), canWrite);
  // บรรทัดใต้ชื่อบัญชี: ธนาคาร · ประเภท · เลขบัญชี (ข้อมูลอื่นอยู่ในกล่องรายละเอียด)
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10);
  const info = [bankLabel(acc.bank_name), ACCOUNT_TYPE_LABEL[acc.account_type] ?? acc.account_type, acc.account_no_masked].filter(Boolean).join(" · ");
  const neg = (v: number | null | undefined) => (Number(v ?? 0) < -0.005 ? "text-red-700" : "");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/financial/cash" className="text-sm text-slate-500 hover:underline">← Cash &amp; Bank Accounts</Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{acc.name}</h1>
          <p className="text-sm text-slate-500">{info}</p>
        </div>
        {canWrite && (
          <EditButton label="บันทึกยอดคงเหลือตาม Statement" title={`บันทึกยอดคงเหลือตาม Statement · ${acc.name}`}>
            <div className="space-y-5">
              <UpdateBalanceForm assetId={id} currency={acc.currency} today={today} minDate={family?.go_live_date ?? ""} />
              <div className="border-t border-slate-100 pt-4">
                <h3 className="mb-2 text-sm font-medium text-slate-800">ยอดตาม Statement · {thMonth(start)}</h3>
                {monthHist.length === 0 ? (
                  <p className="text-sm text-slate-500">ยังไม่มียอดเดือนนี้{lastVal ? <> · ยอดล่าสุด {thDate(lastVal.valuation_date)} = <span className="tabular-nums">{money(lastVal.value, acc.currency)}</span></> : ""}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-slate-500">
                      <tr><th className="py-1">วันที่</th><th className="text-right">ยอด</th><th className="pl-4">ที่มา</th>
                        <th className="pl-4">หมายเหตุ</th><th></th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {monthHist.map((v) => (
                        <tr key={v.id}>
                          <td className="whitespace-nowrap py-1.5">{thDate(v.valuation_date)}</td>
                          <td className={`whitespace-nowrap text-right tabular-nums ${neg(v.value)}`}>{money(v.value, acc.currency)}</td>
                          <td className="pl-4">{SOURCE_LABEL[v.source] ?? v.source}</td>
                          <td className="pl-4 text-slate-500">{v.notes}</td>
                          <td className="pl-2 text-right">
                            {v.source !== "RECONCILIATION" && (
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
                )}
                <p className="mt-2 text-xs text-slate-500">ดูเดือนอื่น: เลือกเดือนที่กล่องรายการเงินเข้า–ออกด้านล่าง</p>
              </div>
            </div>
          </EditButton>
        )}
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {/* ซ้าย: ยอดคงเหลือ + เอกสาร (ยืดให้ขอบล่างเท่ากล่องรายละเอียด) */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
            <div className="text-xs text-slate-500">ยอดคงเหลือล่าสุด</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${neg(balNow)}`}>{balNow == null ? "-" : money(balNow, acc.currency)}</div>
            <div className="mt-1 text-xs text-slate-500">{acc.confirmed_date ? `ยอดตาม Statement ล่าสุด ${thDate(acc.confirmed_date)}` : "ยังไม่มียอดตาม Statement"}</div>
            <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-slate-100 pt-3 text-sm">
              <span className="text-slate-500">ยอดสิ้นเดือนก่อน <span className="text-xs">({thDate(prevEnd)})</span></span>
              <span className={`tabular-nums ${neg(balPrev)}`}>{balPrev == null ? "-" : money(balPrev, acc.currency)}</span>
            </div>
          </div>
          <div className="flex flex-1 flex-col">
            <EntityDocuments category="BANK" entityType="ASSET" entityId={id} module="FINANCIAL" role={me.role} paths={paths} title="เอกสาร / Statement" fill />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h2 className="font-medium text-slate-900">รายละเอียด</h2>
            {canWrite && (
              <EditButton title="แก้ไขรายละเอียด" small>
                <div className="space-y-5">
                  <p className="text-xs text-slate-500">แก้เฉพาะข้อมูลบัญชี ไม่กระทบยอดเงิน</p>
                  <EditInfoForm acc={acc} />
                  <div className="border-t border-slate-100 pt-4">
                    <h3 className="mb-2 text-sm font-medium text-slate-800">เลขบัญชี</h3>
                    <AccountNoPanel assetId={id} bankAccountId={acc.id} masked={acc.account_no_masked} canReveal={canEdit} canSet={canWrite} />
                  </div>
                  <div className="border-t border-slate-100 pt-4">
                    <h3 className="mb-2 text-sm font-medium text-slate-800">เจ้าของบัญชี</h3>
                    <ul className="mb-2 space-y-0.5 text-sm">
                      {activeOwners.map((o) => <li key={o.person_name}>{o.person_name} · {Number(o.ownership_percent)}%</li>)}
                    </ul>
                    <OwnershipEditor kind="asset" id={id} persons={persons ?? []} paths={paths} today={today} startOpen
                      current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent) }))} />
                  </div>
                  <div className="border-t border-slate-100 pt-4">
                    <StatusSelect table="assets" id={id} value={acc.status} paths={paths}
                      options={[["ACTIVE", "ใช้งาน"], ["CLOSED", "ปิดบัญชีแล้ว"]]} label="สถานะบัญชี"
                      remove={canDelete ? { kind: "asset", id, redirectTo: "/financial/cash", paths: ["/financial/cash"], label: "ลบบัญชีนี้",
                        hint: "ลบได้เมื่อไม่มีรายการเงินเข้าออกผูกอยู่ · ปิดบัญชีจริงให้เปลี่ยนสถานะเป็น \"ปิดบัญชีแล้ว\"" } : undefined} />
                  </div>
                </div>
              </EditButton>
            )}
          </div>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Item label="ธนาคาร">{bankLabel(acc.bank_name)}</Item>
            <Item label="ประเภทบัญชี">{ACCOUNT_TYPE_LABEL[acc.account_type] ?? acc.account_type}</Item>
            <Item label="เลขบัญชี" dash>{acc.account_no_masked}</Item>
            <Item label="สกุลเงิน">{acc.currency}</Item>
            <Item label="ชื่อบัญชี" dash>{acc.account_name}</Item>
            <Item label="สาขา" dash>{acc.branch}</Item>
            <Item label="อัตราดอกเบี้ย" dash>{acc.interest_rate != null ? `${Number(acc.interest_rate).toFixed(2)}% ต่อปี` : null}</Item>
            <Item label="วันครบกำหนด" dash>{acc.maturity_date ? <span className={acc.maturity_date < today ? "font-medium text-red-700" : acc.maturity_date <= soon ? "font-medium text-amber-700" : ""}>
              {thDate(acc.maturity_date)}{acc.maturity_date < today ? " (เลยกำหนด)" : acc.maturity_date <= soon ? " (ใกล้ครบ)" : ""}</span> : null}</Item>
            <Item label="สถานะ">{acc.status === "CLOSED" ? <span className="text-slate-500">ปิดบัญชีแล้ว</span> : <span className="text-emerald-700">ใช้งาน</span>}</Item>
            <Item label="เจ้าของ">
              {activeOwners.length === 0 ? "-" : activeOwners.map((o) => <div key={o.person_id}>{o.person_name} · {Number(o.ownership_percent)}%</div>)}
              {ownerTotal < 100 && <div className="text-xs text-amber-700">ยังไม่ระบุเจ้าของ {100 - ownerTotal}%</div>}
            </Item>
            {acc.notes && <Item label="หมายเหตุ" wide><span className="whitespace-pre-line">{acc.notes}</span></Item>}
          </dl>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium text-slate-900">รายการเงินเข้า–ออก {thMonth(start)}</h2>
          <MonthPicker months={months} value={ym} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="text-emerald-700">เงินเข้า <b className="tabular-nums">+{money(sumIn)}</b></span>
          <span className="text-red-700">เงินออก <b className="tabular-nums">−{money(sumOut)}</b></span>
          <span className="text-slate-600">ยอด{end < today ? "สิ้นเดือน" : "ล่าสุด"} <b className={`tabular-nums ${Number(closing ?? 0) < -0.005 ? "text-red-700" : ""}`}>{closing == null ? "-" : money(closing, acc.currency)}</b></span>
        </div>
        {/* เตือนเฉพาะเมื่อมีเรื่องต้องทำ */}
        {st?.lump != null && Math.abs(Number(st.lump)) >= 0.005 && (
          <div className="mt-2 text-xs font-medium text-amber-700">
            <Link href={`/income-expenses?tab=${Number(st.lump) > 0 ? "expense&et" : "income&it"}=split&m=${(st.lump_date ?? st.latest_date).slice(0, 7)}`}
              className="hover:underline">
              มี{Number(st.lump) > 0 ? "ค่าใช้จ่าย" : "รายได้"}รอแยกรายละเอียด {thMonth(`${(st.lump_date ?? st.latest_date).slice(0, 7)}-01`)} {money(Math.abs(Number(st.lump)), acc.currency)} → ไปแยก
            </Link>
          </div>
        )}
        {st && Math.abs(Number(st.difference)) >= 0.005 && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-700">
            <span>ยอดล่าสุด ({thDate(st.latest_date)}) ไม่ตรงกับรายการที่บันทึก {money(st.difference, acc.currency)}</span>
            {canWrite && <SettleLatestButton assetId={id} />}
          </div>
        )}
        <div className="mt-3">
          <MovesView rows={ledgerRows} banks={[]} showActions={canWrite} fixedAcct={id}
            openings={{ [id]: opening == null ? null : Number(opening) }} statements={{ [id]: ledgerStmts }} monthStart={start} />
        </div>
      </section>

    </div>
  );
}
