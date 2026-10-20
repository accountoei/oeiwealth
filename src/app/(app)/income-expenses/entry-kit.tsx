import Link from "next/link";
import type { ReactNode } from "react";
import RowActions from "@/components/RowActions";
import UndoButton from "@/components/UndoButton";
import { INCOME_TYPE_LABEL, MOVE_LABEL, money, thDate } from "@/lib/format";
import { businessDividendFields, debtDropIncomeFields, debtInterestFields, loanInterestFields, premiumPaymentFields, propertyCostFields, rentIncomeFields } from "@/lib/source-edit";
import { splitMoves } from "@/lib/split-moves";
import { stripPending } from "@/lib/ledger";
import type { ExpHint } from "@/lib/category-hints";
import { EntryEditor, type Bank, type Card, type Liab } from "./forms";
import SplitForm from "./SplitForm";
import TransferEditor from "./TransferEditor";
import { TabLink } from "./tabs";
import type { MoveRow } from "./MovesView";

/**
 * ชุดคำสั่งกลางของรายได้ / ค่าใช้จ่าย / เงินเข้า–ออก — ใช้ร่วมกันระหว่างหน้า Income & Expenses และหน้ารายละเอียดบัญชีธนาคาร
 *   แก้ที่ไฟล์นี้ที่เดียว ทั้งสองหน้าเปลี่ยนเหมือนกัน
 *   incEdit / expEdit  = หน้าต่างแก้ไข (+ ลบ) · รายการจากหน้าอื่นใช้ฟอร์มชุดเดียวกับหน้าต้นทาง · ไม่มีฟอร์ม = null (กดชื่อไปแก้ที่ต้นทาง)
 *   incSplit / expSplit = แยกก้อนรอแยกรายละเอียด
 *   buildMoveRows = แถวของตารางเงินเข้า–ออก (MovesView) · กดที่แถวเพื่อแก้ไข
 */

// คอลัมน์ที่ต้องใช้ (select เดียวกันทั้งสองหน้า)
export const INC_SELECT = "id,date,income_type,income_subtype,amount,tax,currency,base_amount,received_to_asset_id,received_to_credit_card_id,received_to_liability_id,person_id,lease_id,source_transaction_id,asset_id,insurance_schedule_line_id,notes,pending_split,recurring_template_id,persons(name),ins_line:insurance_schedule_lines(policy_id),src_asset:assets!income_transactions_asset_id_fkey(name)";
export const EXP_SELECT = "id,date,description,amount,currency,base_amount,expense_category,paid_from_asset_id,paid_from_credit_card_id,liability_id,insurance_schedule_line_id,property_utility_id,source_fee_side,related_asset_id,pending_split,person_id,source_cash_movement_id,is_reimbursable,expected_reimbursement_amount,recurring_expense_id,notes,persons(name),ins_line:insurance_schedule_lines(policy_id)";
export const MOVE_SELECT = "id,movement_date,movement_type,from_asset_id,to_asset_id,to_credit_card_id,to_liability_id,amount,currency,base_amount,counter_amount,counter_currency,fee,is_derived,description,movement_group_id,source_entity_type,source_entity_id";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */
export type IncRec = Rec;
export type ExpRec = Rec;
export type IncFull = IncRec & { full_amount: number; full_tax: number | null };
export type ExpFull = ExpRec & { full_amount: number };

export type Move = { id: string; movement_date: string; movement_type: string; from_asset_id: string | null; to_asset_id: string | null;
  to_credit_card_id: string | null; to_liability_id: string | null; amount: number; currency: string; base_amount?: number | null; counter_amount: number | null;
  counter_currency: string | null; fee: number | null; is_derived: boolean; description: string | null; movement_group_id?: string | null;
  source_entity_type?: string | null; source_entity_id?: string | null; parts?: Move[] };

export const EDITABLE_MOVES = ["TRANSFER", "FX_EXCHANGE", "CARD_PAYMENT", "LIABILITY_PAYMENT", "OTHER_IN", "OTHER_OUT",
  "INVESTMENT_OUT", "INVESTMENT_IN", "LOAN_DISBURSEMENT", "SECURITY_DEPOSIT_IN"];
const NAME_LINK = "cursor-pointer underline decoration-slate-300 underline-offset-2 hover:text-blue-700 hover:decoration-blue-400";
export const SPLIT_BTN = "rounded-md border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100";
const ASSET_PREFIX: Record<string, string> = { LOAN_RECEIVABLE: "เงินให้กู้", INVESTMENT_PORTFOLIO: "พอร์ต", INSURANCE_CASH_VALUE: "มูลค่าเวนคืน" };

/** รับชำระเงินให้กู้ครั้งเดียว (เงินต้น + ดอกเบี้ย) เข้าบัญชีเดียวกัน → รวมเป็น 1 แถว ให้ตรงกับ Statement */
export function mergeGroups(moves: Move[]): Move[] {
  const out: Move[] = []; const byGroup = new Map<string, Move>();
  moves.forEach((m) => {
    const g = m.movement_group_id;
    const merged = g ? byGroup.get(g) : undefined;
    if (merged && merged.to_asset_id && merged.to_asset_id === m.to_asset_id) {
      merged.parts = [...(merged.parts ?? [{ ...merged }]), m];       // เก็บสำเนาส่วนแรกก่อนรวมยอด
      merged.amount = Number(merged.amount) + Number(m.amount);
      merged.base_amount = Number(merged.base_amount ?? 0) + Number(m.base_amount ?? 0);
      return;
    }
    const r = { ...m }; out.push(r);
    if (g) byGroup.set(g, r);
  });
  return out;
}

export const pname = (p: unknown) => ((Array.isArray(p) ? p[0] : p) as { name: string } | null)?.name;
const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;
const policyOf = (x: unknown) => one(x as { policy_id: string } | { policy_id: string }[] | null)?.policy_id;

export type KitCtx = {
  ym: string; personId: string; canWrite: boolean; canDelete: boolean;
  /** หน้าที่ต้องโหลดใหม่หลังแก้ */
  paths: string[];
  banks: Bank[]; cards: Card[]; liabs: Liab[]; persons: { id: string; name: string }[];
  incSubs: string[]; expCats: string[]; expHints: ExpHint[];
  /** เงินเข้า–ออกของเดือน (ใช้หาการรับ / จ่ายครั้งเดียวกัน: เงินต้น + ดอกเบี้ย) */
  moves: Move[];
  incById: Map<string, IncRec>; expById: Map<string, ExpRec>;
  /** ชื่อทรัพย์สินอื่นในรายการเงิน (เงินให้กู้ / พอร์ต / มูลค่าเวนคืน) */
  otherAssets: { id: string; name: string; asset_type: string }[];
  /** หน้า Income & Expenses: ลิงก์สลับแท็บในหน้า · หน้าบัญชี: ไม่มี */
  tabLinks: boolean;
};

export function makeEntryKit(c: KitCtx) {
  const { ym, personId, canWrite, canDelete, paths: PATHS, banks, cards, liabs, persons, incSubs, expCats, expHints } = c;
  const splitLists = { banks, cards, liabs };
  const name = new Map<string, string>([...banks.map((b) => [b.asset_id, b.name] as [string, string]),
    ...cards.map((x) => [x.id, x.label] as [string, string]), ...liabs.map((l) => [l.id, l.name] as [string, string])]);
  const otherName = new Map(c.otherAssets.map((a) => [a.id, [ASSET_PREFIX[a.asset_type], a.name].filter(Boolean).join(" ")]));
  const assetType = new Map(c.otherAssets.map((a) => [a.id, a.asset_type]));
  const bankIds = new Set(banks.map((b) => b.asset_id));
  const placeOf = (id: string | null) => (id ? name.get(id) ?? otherName.get(id) ?? "ทรัพย์สิน" : "ภายนอก");

  // รายการที่สร้างจากหน้าอื่น → หน้าต้นทาง (null = บันทึกที่หน้า Income & Expenses)
  const incSource = (i: IncRec): { href: string; label: string } | null => {
    if (i.source_transaction_id) return { href: `/investments/${i.asset_id}`, label: "พอร์ตลงทุน" };
    if (i.received_to_liability_id) return { href: `/liabilities/${i.received_to_liability_id}`, label: "หนี้สิน" };
    if (i.lease_id) return { href: `/property/${i.asset_id}`, label: "ทรัพย์สิน (สัญญาเช่า)" };
    if (i.insurance_schedule_line_id || i.income_type === "INSURANCE_BENEFIT") {
      const pol = policyOf(i.ins_line);
      return { href: pol ? `/insurance/${pol}` : "/insurance", label: "กรมธรรม์" };
    }
    if (i.income_type === "LOAN_INTEREST" && i.asset_id) return { href: `/financial/loans/${i.asset_id}`, label: "เงินให้กู้" };
    if (i.income_type === "BUSINESS_DIVIDEND" && i.asset_id) return { href: `/financial/business/${i.asset_id}`, label: "กิจการ" };
    if (i.asset_id) return { href: `/a/${i.asset_id}`, label: "ทรัพย์สิน" };
    return null;
  };
  const expSource = (i: ExpRec): { href: string; label: string } | null => {
    if (i.source_cash_movement_id) return { href: `/income-expenses?m=${ym}${personId ? `&p=${personId}` : ""}#moves`, label: "รายการโอน" };
    if (i.liability_id) return { href: `/liabilities/${i.liability_id}`, label: "หนี้สิน" };
    if (i.insurance_schedule_line_id) { const pol = policyOf(i.ins_line); return { href: pol ? `/insurance/${pol}` : "/insurance", label: "กรมธรรม์" }; }
    if (i.property_utility_id) return { href: i.related_asset_id ? `/property/${i.related_asset_id}` : "/property", label: "ทรัพย์สิน (ค่าใช้จ่ายประจำ)" };
    return null;
  };
  // แก้ที่หน้านี้ได้ด้วยฟอร์มชุดเดียวกับหน้าต้นทาง (src/lib/source-edit.ts)
  const sourceEdit = (i: ExpFull) => {
    const row = { date: i.date, amount: i.full_amount, notes: i.notes };
    if (i.source_cash_movement_id) return null;
    if (i.property_utility_id) return propertyCostFields(row);
    if (i.insurance_schedule_line_id) return premiumPaymentFields(row);
    if (i.liability_id) return debtInterestFields(row);
    return null;
  };
  const incSourceEdit = (i: IncFull) => {
    const row = { date: i.date, amount: i.full_amount, tax: i.full_tax, notes: i.notes };
    if (i.received_to_liability_id) return debtDropIncomeFields(row);
    if (i.source_transaction_id || i.insurance_schedule_line_id || i.income_type === "INSURANCE_BENEFIT") return null;
    if (i.lease_id) return i.income_type === "RENT" ? rentIncomeFields(row) : null;   // หักจากเงินประกัน → ยกเลิกที่สัญญา
    if (i.income_type === "LOAN_INTEREST" && i.asset_id) return loanInterestFields(row);
    if (i.income_type === "BUSINESS_DIVIDEND" && i.asset_id) return businessDividendFields(row);
    return null;
  };
  // รับ / จ่ายครั้งเดียวกัน (เงินต้น + ดอกเบี้ย) → ลบทั้งก้อน
  const incGroup = new Map(c.moves.filter((m) => m.source_entity_type === "INCOME" && m.source_entity_id && m.movement_group_id)
    .map((m) => [m.source_entity_id as string, m.movement_group_id as string]));
  const loanPrincipal = new Map(c.moves.filter((m) => m.movement_type === "LOAN_PRINCIPAL_RECEIPT" && m.movement_group_id)
    .map((m) => [m.movement_group_id as string, Number(m.amount)]));
  const expGroup = new Map(c.moves.filter((m) => m.source_entity_type === "EXPENSE" && m.source_entity_id && m.movement_group_id)
    .map((m) => [m.source_entity_id as string, m.movement_group_id as string]));
  const groupPrincipal = new Map(c.moves.filter((m) => m.movement_type === "LIABILITY_PAYMENT" && m.movement_group_id)
    .map((m) => [m.movement_group_id as string, Number(m.amount)]));

  /** แก้ไข / ลบ รายได้ · button = ปุ่มเดียว (ช่องสถานะ) · ไม่ใส่ = กดที่แถว */
  const incEdit = (i: IncFull, button?: string): ReactNode => {
    if (!canWrite || i.pending_split) return null;
    const src = incSource(i);
    if (src) {
      const fields = incSourceEdit(i);
      if (!fields) return null;
      const grp = i.income_type === "LOAN_INTEREST" ? incGroup.get(i.id) : undefined;
      const whole = !!(grp && loanPrincipal.has(grp));
      return (
        <RowActions table="income_transactions" id={i.id} paths={[...PATHS, src.href, "/property", "/financial/loans", "/financial/business"]}
          canDelete={canDelete && !whole} fields={fields} button={button}
          extra={canDelete && whole && grp ? <UndoButton kind="PAYMENT" id={grp} label="ลบรายการนี้" paths={[...PATHS, src.href, "/financial/loans"]}
            confirmText={`ลบการรับชำระวันที่ ${thDate(i.date)}?\nเงินต้น ${money(loanPrincipal.get(grp))} + ดอกเบี้ย ${money(i.full_amount)} จะถูกลบพร้อมกัน\n(ถ้าผิดแค่ยอดดอกเบี้ย ให้แก้ยอดแล้วกดบันทึกแทน)`} /> : undefined} />
      );
    }
    return (
      <RowActions table="income_transactions" id={i.id} paths={PATHS} canDelete={canDelete} button={button}
        editor={<EntryEditor kind="INCOME" id={i.id} currency={i.currency} banks={banks} persons={persons} subtypes={incSubs}
          accountEditable={!i.received_to_credit_card_id && !i.received_to_liability_id}
          personFallback={i.asset_id ? "ตามเจ้าของทรัพย์สิน" : undefined}
          values={{ date: i.date, amount: i.full_amount, tax: i.full_tax, person_id: i.person_id, notes: i.notes,
            income_type: i.income_type, income_subtype: i.income_subtype, bank: i.received_to_asset_id }} />} />
    );
  };
  /** แก้ไข / ลบ ค่าใช้จ่าย */
  const expEdit = (i: ExpFull, button?: string): ReactNode => {
    if (!canWrite || i.pending_split) return null;
    const src = expSource(i);
    if (src) {
      const fields = sourceEdit(i);
      if (!fields) return null;
      const grp = i.liability_id ? expGroup.get(i.id) : undefined;
      const whole = !!(grp && groupPrincipal.has(grp));
      return (
        <RowActions table="expense_items" id={i.id} paths={[...PATHS, src.href.split("?")[0], "/liabilities", "/property", "/insurance"]}
          canDelete={canDelete && !whole} fields={fields} button={button}
          extra={canDelete && whole && grp ? <UndoButton kind="PAYMENT" id={grp} label="ลบรายการนี้" paths={[...PATHS, src.href, "/liabilities"]}
            confirmText={`ลบการจ่ายวันที่ ${thDate(i.date)}?\nเงินต้น ${money(groupPrincipal.get(grp))} + ดอกเบี้ย ${money(i.full_amount)} จะถูกลบพร้อมกัน\n(ถ้าผิดแค่ยอดดอกเบี้ย ให้แก้ยอดแล้วกดบันทึกแทน)`} /> : undefined} />
      );
    }
    return (
      <RowActions table="expense_items" id={i.id} paths={PATHS} canDelete={canDelete} button={button}
        editor={<EntryEditor kind="EXPENSE" id={i.id} currency={i.currency} banks={banks} cards={cards} persons={persons}
          categories={expCats} reimbursable={!!i.is_reimbursable}
          values={{ date: i.date, amount: i.full_amount, description: i.description, category: i.expense_category,
            person_id: i.person_id, notes: i.notes, expected_reimbursement_amount: i.expected_reimbursement_amount,
            bank: i.paid_from_asset_id, card: i.paid_from_credit_card_id }} />} />
    );
  };
  /** แยกก้อนรอแยก: ปุ่ม (ตาราง) หรือกดที่แถว (ตารางเงินเข้า–ออก) */
  const incSplit = (i: IncFull, rowClick = false) => canWrite && canDelete && i.pending_split ? (
    <SplitForm key={`${i.id}-${i.full_amount}`} kind="INCOME" id={i.id} amount={Number(i.full_amount)} currency={i.currency} persons={persons}
      label="แยกรายละเอียด" rowClick={rowClick} buttonCls={SPLIT_BTN}
      personDefault={i.received_to_liability_id ? "ตามผู้รับผิดชอบหนี้" : i.received_to_credit_card_id ? "ตามเจ้าของบัตร" : "ตามเจ้าของบัญชี"}
      moves={splitMoves({ kind: "INCOME", currency: i.currency, bank: i.received_to_asset_id, card: i.received_to_credit_card_id, liab: i.received_to_liability_id }, splitLists)} />
  ) : null;
  const expSplit = (i: ExpFull, rowClick = false) => canWrite && canDelete && i.pending_split ? (
    <SplitForm key={`${i.id}-${i.full_amount}`} kind="EXPENSE" id={i.id} amount={Number(i.full_amount)} currency={i.currency} persons={persons} categories={expCats}
      label="แยกรายละเอียด" rowClick={rowClick} buttonCls={SPLIT_BTN}
      personDefault={i.liability_id ? "ตามผู้รับผิดชอบหนี้" : i.paid_from_credit_card_id ? "ตามเจ้าของบัตร" : "ตามเจ้าของบัญชี"} hints={expHints}
      moves={splitMoves({ kind: "EXPENSE", currency: i.currency, bank: i.paid_from_asset_id, card: i.paid_from_credit_card_id, liab: i.liability_id }, splitLists)} />
  ) : null;

  // กดที่รายละเอียดเพื่อไปหน้าต้นทาง (ขีดเส้นใต้ · เมาส์เป็นรูปมือ)
  const srcLink = (l: { href: string; label: string; tab?: string } | null, text: ReactNode) => {
    if (!l || !text) return text;
    return l.tab ? <TabLink tab={l.tab} href={l.href} className={NAME_LINK}>{text}</TabLink>
      : <Link href={l.href} title={`แก้ที่หน้า${l.label}`} className={NAME_LINK}>{text}</Link>;
  };
  const tabLink = (tab: string, label: string) => (c.tabLinks
    ? { href: `/income-expenses?tab=${tab}&m=${ym}${personId ? `&p=${personId}` : ""}`, label, tab } : null);
  const full = (i: IncRec): IncFull => ({ ...i, full_amount: Number(i.amount), full_tax: i.tax });

  /** แถวของตารางเงินเข้า–ออก · withActions = กดที่แถวเพื่อแก้ไข / แยกก้อน */
  const buildMoveRows = (list: Move[], withActions: boolean): MoveRow[] => mergeGroups(list).map((m) => {
    let detail: ReactNode = m.description;
    let link: { href: string; label: string; tab?: string } | null = null;
    let type = MOVE_LABEL[m.movement_type] ?? m.movement_type;
    let pending = false;
    if (m.parts) {
      type = "รับชำระเงินให้กู้";
      detail = m.parts.map((x) => `${x.movement_type === "LOAN_PRINCIPAL_RECEIPT" ? "เงินต้น" : x.movement_type === "INCOME" ? "ดอกเบี้ย" : MOVE_LABEL[x.movement_type] ?? x.movement_type} ${money(x.amount)}`).join(" + ");
      const loan = m.parts.find((x) => x.from_asset_id)?.from_asset_id;
      link = loan ? { href: `/financial/loans/${loan}`, label: "เงินให้กู้" } : null;
    } else if (m.is_derived && m.source_entity_type === "INCOME") {
      const inc = m.source_entity_id ? c.incById.get(m.source_entity_id) : undefined;
      if (inc) {
        type = INCOME_TYPE_LABEL[inc.income_type] ?? type;
        pending = !!inc.pending_split;
        detail = [inc.lease_id || inc.asset_id ? pname(inc.src_asset) : null, inc.notes].filter(Boolean).join(" · ") || type;
        link = incSource(inc);                                  // บันทึกที่หน้า Income & Expenses → กดที่แถวเพื่อแก้
      } else link = tabLink("income", "แท็บรายได้");
    } else if (m.is_derived && m.source_entity_type === "EXPENSE") {
      const it = m.source_entity_id ? c.expById.get(m.source_entity_id) : undefined;
      if (it) { detail = it.description; pending = !!it.pending_split; link = expSource(it); if (link?.label === "รายการโอน") link = null; }
      else link = tabLink("expense", "แท็บค่าใช้จ่าย");
    } else if (m.is_derived && m.source_entity_type === "REIMBURSEMENT") {
      link = tabLink("expense", "แท็บค่าใช้จ่าย");
    } else if (m.is_derived && m.source_entity_type === "INVESTMENT_TX") {
      const pf = [m.from_asset_id, m.to_asset_id].find((x) => x && assetType.get(x) === "INVESTMENT_PORTFOLIO");
      link = { href: pf ? `/investments/${pf}` : "/investments", label: "พอร์ตลงทุน" };
    } else if (m.is_derived) {
      link = null;
    }
    const counter = m.counter_amount != null ? Number(m.counter_amount) : Number(m.amount);
    const inc = m.is_derived && m.source_entity_type === "INCOME" && m.source_entity_id ? c.incById.get(m.source_entity_id) : undefined;
    const exp = m.is_derived && m.source_entity_type === "EXPENSE" && m.source_entity_id ? c.expById.get(m.source_entity_id) : undefined;
    return {
      key: m.id, date: m.movement_date, type, typeCls: m.movement_type === "REIMBURSEMENT_IN" ? "text-sky-700" : undefined,
      kind: m.movement_type, merged: !!m.parts, fee: Number(m.fee ?? 0),
      metaOpts: { incomeType: inc?.income_type ?? null, incomeSubtype: inc?.income_subtype ?? null,
        expenseCategory: exp?.expense_category ?? null, pending: !!(inc?.pending_split || exp?.pending_split) },
      fromLabel: placeOf(m.from_asset_id),
      toLabel: m.to_credit_card_id ? `บัตร ${placeOf(m.to_credit_card_id)}` : m.to_liability_id ? placeOf(m.to_liability_id) : placeOf(m.to_asset_id),
      fromBank: m.from_asset_id && bankIds.has(m.from_asset_id) ? m.from_asset_id : null,
      toBank: m.to_asset_id && bankIds.has(m.to_asset_id) ? m.to_asset_id : null,
      fromAmount: Number(m.amount), fromCcy: m.currency, toAmount: counter, toCcy: m.counter_currency ?? m.currency,
      extra: <>
        {m.counter_amount != null && (m.counter_currency !== m.currency || Number(m.counter_amount) !== Number(m.amount)) && <div className="text-xs text-slate-500">{money(m.amount, m.currency)} → {money(m.counter_amount, m.counter_currency ?? undefined)}</div>}
        {m.counter_amount == null && m.counter_currency && <div className="text-xs text-amber-700">→ รอยอด {m.counter_currency}</div>}
        {Number(m.fee ?? 0) > 0 && <div className="text-xs text-slate-500">ค่าธรรมเนียม {money(m.fee)}</div>}
      </>,
      thb: m.base_amount == null ? null : Number(m.base_amount),
      // แยกก้อนได้ที่นี่ (กดที่แถว) → ป้ายไม่ต้องเป็นลิงก์
      pendingHref: withActions && canDelete || !c.tabLinks ? undefined
        : inc?.pending_split ? `${tabLink("income", "")?.href}&it=split` : exp?.pending_split ? `${tabLink("expense", "")?.href}&et=split` : undefined,
      detail: srcLink(link, (pending && typeof detail === "string" ? stripPending(detail) : detail) || type),
      actions: withActions && !m.parts && !m.is_derived && EDITABLE_MOVES.includes(m.movement_type) ? (
        <RowActions table="cash_movements" id={m.id} paths={PATHS} canDelete={canDelete}
          deleteNote={m.movement_type === "INVESTMENT_OUT" || m.movement_type === "INVESTMENT_IN" ? "รายการฝาก/ถอนในพอร์ตจะถูกลบตาม" : undefined}
          editor={m.movement_type === "TRANSFER" && m.from_asset_id && m.to_asset_id && bankIds.has(m.from_asset_id) && bankIds.has(m.to_asset_id)
            && (m.counter_currency == null || m.counter_currency === m.currency) ? (
            <TransferEditor id={m.id} banks={banks.filter((b) => b.currency === m.currency)}
              values={{ from: m.from_asset_id, to: m.to_asset_id, date: m.movement_date, amount: Number(m.amount),
                fee: m.fee == null ? null : Number(m.fee), description: m.description }} />) : undefined}
          fields={[
            { name: "movement_date", label: "วันที่", type: "date", value: m.movement_date },
            { name: "amount", label: "จำนวน", type: "number", value: m.amount },
            ...(m.movement_type === "FX_EXCHANGE" ? [{ name: "counter_amount", label: "ยอดปลายทาง", type: "number" as const, value: m.counter_amount }] : []),
            ...(["TRANSFER", "FX_EXCHANGE"].includes(m.movement_type) ? [{ name: "fee", label: "ค่าธรรมเนียม", type: "number" as const, value: m.fee }] : []),
            { name: "description", label: "รายละเอียด", value: m.description, width: "w-40" }]} />
      )
        // เงินเข้า–ออกจากรายได้ / ค่าใช้จ่าย → กดที่แถว: แก้ไข (ฟอร์มชุดเดียวกับแท็บรายได้ / ค่าใช้จ่าย) หรือแยกก้อนรอแยก
        //   แก้ที่นี่ไม่ได้ (พอร์ตลงทุน / รับชำระเงินให้กู้ / เงินประกัน ฯลฯ) → แถวกดไม่ได้ · กดชื่อไปหน้าต้นทาง
        : withActions && inc && !m.parts ? (inc.pending_split ? incSplit(full(inc), true) : incEdit(full(inc)))
        : withActions && exp ? (exp.pending_split ? expSplit({ ...exp, full_amount: Number(exp.amount) }, true)
            : expEdit({ ...exp, full_amount: Number(exp.amount) }))
        : null,
    };
  });

  return { incSource, expSource, incEdit, expEdit, incSplit, expSplit, buildMoveRows, name, placeOf, bankIds };
}
