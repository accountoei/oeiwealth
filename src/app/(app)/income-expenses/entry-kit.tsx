import Link from "next/link";
import type { ReactNode } from "react";
import RowActions from "@/components/RowActions";
import UndoButton from "@/components/UndoButton";
import { INCOME_TYPE_LABEL, MOVE_LABEL, money, thDate } from "@/lib/format";
import { assetIncomeFields, businessDividendFields, debtDropIncomeFields, debtInterestFields, loanInterestFields, portfolioTxFields, premiumPaymentFields, propertyCostFields, rentIncomeFields } from "@/lib/source-edit";
import { sourceMeta, stripPending } from "@/lib/ledger";
import PropertyPaymentForm from "../property/PropertyPaymentForm";
import { ReceiptEdit } from "../insurance/[id]/FlowRecord";
import type { KitExtras, KitReceipt } from "./kit-extras";
import { PART_LABEL as INS_PART_LABEL, partRank } from "@/lib/insurance-booklet";
import type { ExpHint } from "@/lib/category-hints";
import { EntryEditor, type Bank, type Card, type Liab } from "./forms";
import SplitForm, { type SplitSides } from "./SplitForm";
import TransferEditor from "./TransferEditor";
import PfTransferEditor from "./PfTransferEditor";
import PairEdit from "@/components/PairEdit";
import { TabLink } from "./tabs";
import type { MoveRow } from "./MovesView";
import type { PfCash } from "@/lib/pf-cash";

/**
 * ชุดคำสั่งกลางของรายได้ / ค่าใช้จ่าย / เงินเข้า–ออก — ใช้ร่วมกันระหว่างหน้า Income & Expenses และหน้ารายละเอียดบัญชีธนาคาร
 *   แก้ที่ไฟล์นี้ที่เดียว ทั้งสองหน้าเปลี่ยนเหมือนกัน
 *   incEdit / expEdit  = หน้าต่างแก้ไข (+ ลบ) · รายการจากหน้าอื่นใช้ฟอร์มชุดเดียวกับหน้าต้นทาง · ไม่มีฟอร์ม = null (กดชื่อไปแก้ที่ต้นทาง)
 *   incSplit / expSplit = แยกก้อนรอแยกรายละเอียด
 *   buildMoveRows = แถวของตารางเงินเข้า–ออก (MovesView) · กดที่แถวเพื่อแก้ไข
 */

// คอลัมน์ที่ต้องใช้ (select เดียวกันทั้งสองหน้า)
export const INC_SELECT = "id,date,income_type,income_subtype,amount,tax,currency,base_amount,received_to_asset_id,received_to_credit_card_id,received_to_liability_id,person_id,lease_id,source_transaction_id,asset_id,insurance_schedule_line_id,notes,pending_split,recurring_template_id,persons(name),ins_line:insurance_schedule_lines(policy_id),src_asset:assets!income_transactions_asset_id_fkey(name),src_tx:investment_transactions!income_transactions_source_transaction_id_fkey(id,transaction_type,transaction_date,settlement_date,settle_to_asset_id,amount,fee,tax,notes,cash_movement_id)";
export const EXP_SELECT = "id,date,description,amount,currency,base_amount,expense_category,property_cost_type,paid_from_asset_id,paid_from_credit_card_id,paid_from_cash_holding_id,liability_id,insurance_schedule_line_id,property_utility_id,source_fee_side,related_asset_id,pending_split,person_id,source_cash_movement_id,is_reimbursable,expected_reimbursement_amount,recurring_expense_id,notes,persons(name),ins_line:insurance_schedule_lines(policy_id,installment_no,pol:insurance_policies(insurance_type,insurer,policy_no)),payment_group_id,internal_loan_income_id,il:income_transactions!expense_items_internal_loan_income_id_fkey(asset_id),source_investment_tx_id,src_itx:investment_transactions!expense_items_source_investment_tx_id_fkey(id,transaction_type,transaction_date,amount,fee,notes,cash_movement_id)";
export const MOVE_SELECT = "id,movement_date,movement_type,from_asset_id,to_asset_id,to_credit_card_id,to_liability_id,amount,currency,base_amount,counter_amount,counter_currency,counter_fee,cash_holding_id,fee,is_derived,description,movement_group_id,source_entity_type,source_entity_id,metadata,lease:property_leases!cash_movements_related_lease_id_fkey(pd:property_details!property_leases_property_id_fkey(asset_id))";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */
export type IncRec = Rec;
export type ExpRec = Rec;
export type IncFull = IncRec & { full_amount: number; full_tax: number | null };
export type ExpFull = ExpRec & { full_amount: number };

export type Move = { id: string; movement_date: string; movement_type: string; from_asset_id: string | null; to_asset_id: string | null;
  to_credit_card_id: string | null; to_liability_id: string | null; amount: number; currency: string; base_amount?: number | null; counter_amount: number | null;
  counter_currency: string | null; counter_fee?: number | null; cash_holding_id?: string | null; fee: number | null; is_derived: boolean; description: string | null; movement_group_id?: string | null;
  source_entity_type?: string | null; source_entity_id?: string | null; metadata?: unknown; parts?: Move[];
  /** เงินประกันการเช่า → ทรัพย์สินของสัญญา (ลิงก์ไปแก้ที่สัญญา) */ lease?: unknown };

// เงินประกันการเช่า (รับ / คืน) แก้ที่สัญญาเท่านั้น (ตกลง 6 พ.ย. 2026 · ฐานข้อมูลกัน) → DEPOSIT_NOTE ใต้รายการ
export const EDITABLE_MOVES = ["TRANSFER", "FX_EXCHANGE", "CARD_PAYMENT", "LIABILITY_PAYMENT", "OTHER_IN", "OTHER_OUT",
  "INVESTMENT_OUT", "INVESTMENT_IN", "LOAN_DISBURSEMENT"];
const DEPOSIT_MOVES = ["SECURITY_DEPOSIT_IN", "SECURITY_DEPOSIT_OUT"];
const AMT = "tabular-nums underline decoration-dotted underline-offset-4 hover:text-blue-700";
const NAME_LINK = "cursor-pointer underline decoration-slate-300 underline-offset-2 hover:text-blue-700 hover:decoration-blue-400";
export const SPLIT_BTN = "rounded-md border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100";
const ASSET_PREFIX: Record<string, string> = { LOAN_RECEIVABLE: "เงินให้กู้", INVESTMENT_PORTFOLIO: "พอร์ต", INSURANCE_CASH_VALUE: "มูลค่าเวนคืน" };

/**
 * รับชำระเงินให้กู้ครั้งเดียว (เงินต้น + ดอกเบี้ย) เข้าบัญชีเดียวกัน → รวมเป็น 1 แถว ให้ตรงกับ Statement
 *   outOk = เงินออกที่รวมได้ (เบี้ยประกันเล่มเดียวกันที่จ่ายพร้อมกัน · ตกลง 6 พ.ย. 2026): บัญชีเดียวกัน วันเดียวกัน สกุลเดียวกัน
 */
export function mergeGroups(moves: Move[], outOk: (m: Move) => boolean = () => false): Move[] {
  const out: Move[] = []; const byGroup = new Map<string, Move>();
  moves.forEach((m) => {
    const g = m.movement_group_id;
    const merged = g ? byGroup.get(g) : undefined;
    const sameOut = !!merged && !merged.to_asset_id && !m.to_asset_id && !!merged.from_asset_id && merged.from_asset_id === m.from_asset_id
      && merged.movement_date === m.movement_date && merged.currency === m.currency && outOk(merged) && outOk(m);
    if (merged && ((merged.to_asset_id && merged.to_asset_id === m.to_asset_id) || sameOut)) {
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
  /** บัญชีเงินฝากในพอร์ต (ค่าใช้จ่ายจ่ายจากพอร์ต) */
  pfCash: PfCash[];
  incSubs: string[]; expCats: string[]; expHints: ExpHint[];
  /** เงินเข้า–ออกของเดือน (ใช้หาการรับ / จ่ายครั้งเดียวกัน: เงินต้น + ดอกเบี้ย) */
  moves: Move[];
  incById: Map<string, IncRec>; expById: Map<string, ExpRec>;
  /** ชื่อทรัพย์สินอื่นในรายการเงิน (เงินให้กู้ / พอร์ต / มูลค่าเวนคืน) */
  otherAssets: { id: string; name: string; asset_type: string; asset_group?: string | null }[];
  /** ข้อมูลของแถวที่มาจากหน้าอื่น (รับเงินประกัน · แถวของ Property · รายการในพอร์ต) → ฟอร์มของหน้าต้นทาง (kit-extras.ts) */
  extras?: KitExtras;
  /** หน้า Income & Expenses: ลิงก์สลับแท็บในหน้า · หน้าบัญชี: ไม่มี */
  tabLinks: boolean;
  /** บ้าน / ที่ดิน ให้เลือกตอนแก้ค่าใช้จ่ายหมวดบ้าน / สาธารณูปโภค */
  properties?: { id: string; name: string }[];
  /** รายได้ / ค่าใช้จ่ายที่สร้างตอนบันทึกผู้เช่าออก → แก้ / ลบที่นี่ไม่ได้ (ยกเลิกทั้งชุดที่สัญญาเช่า · ฐานข้อมูลล็อกไว้) */
  closeoutIds?: Set<string>;
};

/** รายการจากผู้เช่าออก: กดแก้ไม่ได้ → บอกที่ยกเลิก (ข้อความเดียวกับหน้าทรัพย์สิน) */
export const CLOSEOUT_NOTE = <div className="text-xs text-slate-400">มาจากผู้เช่าออก · ยกเลิกที่ &ldquo;ยกเลิกผู้เช่าออก&rdquo; ในสัญญา</div>;
const DEPOSIT_NOTE = <div className="text-xs text-slate-400">เงินประกันของสัญญาเช่า · แก้ / ยกเลิกที่สัญญาในหน้าทรัพย์สิน</div>;

/** id ของรายได้ / ค่าใช้จ่ายที่สร้างตอนบันทึกผู้เช่าออก (lease_closeouts ที่ยังไม่ยกเลิก) */
export const closeoutIdSet = (rows: { income_ids: string[] | null; expense_id: string | null }[] | null | undefined) =>
  new Set((rows ?? []).flatMap((r) => [...(r.income_ids ?? []), ...(r.expense_id ? [r.expense_id] : [])]));

export function makeEntryKit(c: KitCtx) {
  const { ym, personId, canWrite, canDelete, paths: PATHS, banks, cards, liabs, persons, incSubs, expCats, expHints } = c;
  const name = new Map<string, string>([...banks.map((b) => [b.asset_id, b.name] as [string, string]),
    ...cards.map((x) => [x.id, x.label] as [string, string]), ...liabs.map((l) => [l.id, l.name] as [string, string])]);
  const otherName = new Map(c.otherAssets.map((a) => [a.id, [ASSET_PREFIX[a.asset_type], a.name].filter(Boolean).join(" ")]));
  const assetType = new Map(c.otherAssets.map((a) => [a.id, a.asset_type]));
  const bankIds = new Set(banks.map((b) => b.asset_id));
  const fromCloseout = (id: string) => !!c.closeoutIds?.has(id);
  const placeOf = (id: string | null) => (id ? name.get(id) ?? otherName.get(id) ?? "ทรัพย์สิน" : "ภายนอก");

  // แถวที่มาจากหน้าอื่น → ฟอร์มของหน้าต้นทาง (ตกลง 9 พ.ย. 2026) · ข้อมูลจาก kit-extras.ts
  const assetById = new Map(c.otherAssets.map((a) => [a.id, a]));
  const rcByMove = new Map((c.extras?.receipts ?? []).filter((r) => r.movement_id).map((r) => [r.movement_id as string, r]));
  const rcByIncome = new Map((c.extras?.receipts ?? []).filter((r) => r.income_id).map((r) => [r.income_id as string, r]));
  const compsOf = (assetId: string) => (c.extras?.comps ?? []).filter((x) => x.asset_id === assetId).map(({ id, label, type }) => ({ id, label, type }));
  const itxById = new Map((c.extras?.itxs ?? []).map((t) => [t.id, t]));
  type AssetMeta = { policy_id?: string; part_sale?: boolean; share_sale?: boolean; share_buy?: boolean; add_value?: boolean; component_id?: string };
  /** ซื้อ / ขายทรัพย์สิน → หน้าของทรัพย์สินนั้น (ถอนมูลค่าเวนคืน → หน้ากรมธรรม์) */
  const assetLink = (m: Move): { href: string; label: string } | null => {
    const meta = (m.metadata ?? {}) as AssetMeta;
    if (meta.policy_id) return { href: `/insurance/${meta.policy_id}?tab=flow`, label: "กรมธรรม์" };
    const id = m.movement_type === "ASSET_PURCHASE" ? m.to_asset_id : m.from_asset_id;
    if (!id) return null;
    const a = assetById.get(id);
    if (a?.asset_type === "PRIVATE_BUSINESS") return { href: `/financial/business/${id}`, label: "กิจการ" };
    if (a?.asset_group === "PROPERTY") return { href: `/property/${id}`, label: "Property" };
    if (a?.asset_group === "ALTERNATIVE") return { href: `/alternative/${id}`, label: "Alternative" };
    return { href: `/a/${id}`, label: "ทรัพย์สิน" };
  };
  /** รับเงินประกัน (ถอนมูลค่าเวนคืน / ผลประโยชน์ส่วนที่เป็นรายได้) → หน้าต่างแก้รายการรับแบบหน้ากรมธรรม์
   *  แก้ / ลบได้เฉพาะรายการรับล่าสุดของกรมธรรม์ และ ADMIN / EDITOR (เหมือนหน้ากรมธรรม์) · อื่น ๆ = ลิงก์ไปหน้ากรมธรรม์ */
  const receiptEdit = (r: KitReceipt | undefined): ReactNode => (r && r.latest && canWrite && canDelete ? (
    <ReceiptEdit r={{ id: r.id, date: r.receipt_date, amount: r.amount, bank_asset_id: r.bank_asset_id, notes: r.notes, outcome: r.outcome,
      cash_value_part: r.cash_value_part }} currency={r.currency} banks={banks} hasCashValue={r.has_cv}
      paths={[...PATHS, `/insurance/${r.policy_id}`, "/insurance"]} />) : null);

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
    if (fromCloseout(i.id) && i.related_asset_id) return { href: `/property/${i.related_asset_id}`, label: "ทรัพย์สิน (ผู้เช่าออก)" };
    if (i.internal_loan_income_id) return { href: i.il?.asset_id ? `/financial/loans/${i.il.asset_id}` : "/financial/loans", label: "เงินกู้ภายในครอบครัว" };
    if (i.source_investment_tx_id) return { href: i.related_asset_id ? `/investments/${i.related_asset_id}` : "/investments", label: "พอร์ตลงทุน" };
    if (i.source_cash_movement_id) return { href: `/income-expenses?m=${ym}${personId ? `&p=${personId}` : ""}#moves`, label: "รายการโอน" };
    if (i.liability_id) return { href: `/liabilities/${i.liability_id}`, label: "หนี้สิน" };
    if (i.insurance_schedule_line_id) { const pol = policyOf(i.ins_line); return { href: pol ? `/insurance/${pol}` : "/insurance", label: "กรมธรรม์" }; }
    if (i.property_utility_id) return { href: i.related_asset_id ? `/property/${i.related_asset_id}` : "/property", label: "ทรัพย์สิน (ค่าใช้จ่ายประจำ)" };
    return null;
  };
  // แก้ที่หน้านี้ได้ด้วยฟอร์มชุดเดียวกับหน้าต้นทาง (src/lib/source-edit.ts)
  const sourceEdit = (i: ExpFull) => {
    const row = { date: i.date, amount: i.full_amount, notes: i.notes };
    if (i.source_cash_movement_id || i.source_investment_tx_id || i.internal_loan_income_id) return null;   // ดอกเบี้ยจ่ายเงินกู้ภายใน: แก้ที่รายการรับชำระ
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
    if (i.income_type === "OTHER" && i.asset_id) return assetIncomeFields(row);   // ผลตอบแทน Alternative
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

  // ผลของการลบรายการที่บันทึกที่หน้านี้ — บอกให้ชัดว่ายอดไหนถูกยกเลิก (แทนข้อความกลาง "ข้อมูลที่ระบบสร้างขึ้น…")
  const pfName = new Map(c.pfCash.map((h) => [h.id, h.label]));
  const incDeleteEffect = (i: IncRec) => [
    i.received_to_asset_id ? `เงินเข้า ${placeOf(i.received_to_asset_id)} จะถูกยกเลิก (ยอดบัญชีกลับเป็นเหมือนก่อนบันทึก)`
      : i.received_to_credit_card_id ? `เงินเข้าบัตร ${name.get(i.received_to_credit_card_id) ?? ""} จะถูกยกเลิก` : "",
    i.recurring_template_id ? "รายการประจำงวดนี้จะกลับไปอยู่ใน \"ที่ต้องได้รับ\"" : "",
    "รายการเดือนอื่นไม่ถูกลบ",
  ].filter(Boolean).join("\n");
  const expDeleteEffect = (i: ExpRec) => [
    i.paid_from_asset_id ? `เงินออกจาก ${placeOf(i.paid_from_asset_id)} จะถูกยกเลิก (ยอดบัญชีกลับเป็นเหมือนก่อนบันทึก)`
      : i.paid_from_credit_card_id ? `ยอดรูดบัตร ${name.get(i.paid_from_credit_card_id) ?? ""} จะถูกยกเลิก`
      : i.paid_from_cash_holding_id ? `เงินออกจาก ${pfName.get(i.paid_from_cash_holding_id) ?? "บัญชีเงินฝากในพอร์ต"} จะถูกยกเลิก` : "",
    i.recurring_expense_id ? "รายการประจำงวดนี้จะกลับไปอยู่ใน \"ที่ต้องจ่าย\"" : "",
    "รายการเดือนอื่นไม่ถูกลบ",
  ].filter(Boolean).join("\n");

  const full = (i: IncRec): IncFull => ({ ...i, full_amount: Number(i.amount), full_tax: i.tax });
  const moveById = new Map(c.moves.map((m) => [m.id, m]));
  // รายได้จากพอร์ตตามรายการในพอร์ต (เงินเข้าบัญชีจากปันผล / ดอกเบี้ย / คูปอง)
  const incByTx = new Map([...c.incById.values()].filter((x) => x.source_transaction_id).map((x) => [x.source_transaction_id as string, x]));

  /** แก้ไข / ลบ เงินเข้า–ออกที่บันทึกเอง (ไม่ใช่รายการที่ระบบสร้าง) · ใช้ทั้งตารางเงินเข้า–ออก และแถวค่าธรรมเนียมโอน (ตกลง 5 พ.ย. 2026)
   *   โอน ธนาคาร ↔ พอร์ต = ช่องครบเหมือนหน้าพอร์ต (ค่าธรรมเนียมต้นทาง / ปลายทาง · ยอดที่เข้าจริง · บัญชีในพอร์ต) */
  const moveEdit = (m: Move, opt: { button?: string; note?: string; deleteNote?: string } = {}): ReactNode => {
    if (!canWrite || m.parts || m.is_derived || !EDITABLE_MOVES.includes(m.movement_type)) return null;
    const pfMove = m.movement_type === "INVESTMENT_OUT" || m.movement_type === "INVESTMENT_IN";
    const pf = pfMove ? (m.movement_type === "INVESTMENT_OUT" ? m.to_asset_id : m.from_asset_id) : null;
    const bank = pfMove ? (m.movement_type === "INVESTMENT_OUT" ? m.from_asset_id : m.to_asset_id) : null;
    const accts = pf ? c.pfCash.filter((h) => h.portfolio === pf) : [];
    // บัญชีในพอร์ตของรายการนี้ปิดไปแล้ว (ไม่อยู่ในรายการให้เลือก) → ใช้ช่องแบบเดิม (ไม่เปลี่ยนบัญชีโดยไม่ตั้งใจ)
    const pfOk = !!(pf && bank && bankIds.has(bank) && accts.length && (!m.cash_holding_id || accts.some((h) => h.id === m.cash_holding_id)));
    const editor = pfOk && pf && bank ? (
      <PfTransferEditor id={m.id} portfolioId={pf} bankId={bank} bankLabel={placeOf(bank)} portfolioLabel={placeOf(pf)} note={opt.note}
        accounts={accts.map((h) => ({ id: h.id, label: h.label.split(" · ").slice(1).join(" · ") || h.label, currency: h.currency }))}
        values={{ type: m.movement_type, date: m.movement_date, amount: Number(m.amount), currency: m.currency,
          fee: m.fee == null ? null : Number(m.fee), counterAmount: m.counter_amount == null ? null : Number(m.counter_amount),
          counterCurrency: m.counter_currency, counterFee: m.counter_fee == null ? null : Number(m.counter_fee),
          cashHoldingId: m.cash_holding_id ?? null, description: m.description }} />
    ) : m.movement_type === "TRANSFER" && m.from_asset_id && m.to_asset_id && bankIds.has(m.from_asset_id) && bankIds.has(m.to_asset_id)
      && (m.counter_currency == null || m.counter_currency === m.currency) ? (
      <TransferEditor id={m.id} banks={banks.filter((b) => b.currency === m.currency)}
        values={{ from: m.from_asset_id, to: m.to_asset_id, date: m.movement_date, amount: Number(m.amount),
          fee: m.fee == null ? null : Number(m.fee), description: m.description }} />) : undefined;
    return (
      <RowActions table="cash_movements" id={m.id} paths={PATHS} canDelete={canDelete} button={opt.button}
        deleteNote={opt.deleteNote ?? (pfMove ? "รายการฝาก/ถอนในพอร์ตจะถูกลบตาม" : undefined)}
        editor={editor}
        fields={[
          { name: "movement_date", label: "วันที่", type: "date", value: m.movement_date },
          { name: "amount", label: "จำนวน", type: "number", value: m.amount },
          ...(m.movement_type === "FX_EXCHANGE" ? [{ name: "counter_amount", label: "ยอดปลายทาง", type: "number" as const, value: m.counter_amount }] : []),
          ...(["TRANSFER", "FX_EXCHANGE"].includes(m.movement_type) ? [{ name: "fee", label: "ค่าธรรมเนียม", type: "number" as const, value: m.fee }] : []),
          { name: "description", label: "รายละเอียด", value: m.description, width: "w-40" }]} />
    );
  };

  /** แก้ไข / ลบ รายได้ · button = ปุ่มเดียว (ช่องสถานะ) · ไม่ใส่ = กดที่แถว */
  const incEdit = (i: IncFull, button?: string): ReactNode => {
    if (!canWrite || i.pending_split || fromCloseout(i.id)) return null;
    // รับเงินประกัน (ส่วนที่เกินมูลค่าเวนคืน = รายได้) → หน้าต่างแก้รายการรับแบบหน้ากรมธรรม์ (กดที่แถวเท่านั้น)
    const rc = rcByIncome.get(i.id);
    if (rc) return button ? null : receiptEdit(rc);
    const src = incSource(i);
    // รายได้จากพอร์ต (ปันผล / ดอกเบี้ย / คูปอง) → แก้รายการในพอร์ตที่สร้างรายได้นี้ (ช่องเดียวกับหน้าพอร์ต)
    const tx = i.source_transaction_id ? one(i.src_tx as Rec | Rec[] | null) : null;
    if (src && tx && !tx.cash_movement_id) return (
      <RowActions table="investment_transactions" id={tx.id} paths={[...PATHS, src.href, "/investments"]} canDelete={canDelete} button={button}
        deleteNote="รายได้ / เงินเข้าออกบัญชีที่ระบบสร้างจากรายการนี้จะถูกลบตาม"
        fields={[
          { name: "transaction_date", label: "วันที่", type: "date", value: tx.transaction_date },
          ...(tx.settle_to_asset_id ? [{ name: "settlement_date", label: "วันชำระ", type: "date" as const, value: tx.settlement_date }] : []),
          { name: "amount", label: "ยอด", type: "number", value: tx.amount },
          { name: "fee", label: "ค่าธรรมเนียม", type: "number", value: tx.fee },
          { name: "tax", label: "ภาษี", type: "number", value: tx.tax },
          { name: "notes", label: "หมายเหตุ", value: tx.notes, width: "w-40" }]} />
    );
    if (src) {
      const fields = incSourceEdit(i);
      if (!fields) return null;
      const grp = i.income_type === "LOAN_INTEREST" ? incGroup.get(i.id) : undefined;
      const whole = !!(grp && loanPrincipal.has(grp));
      return (
        <RowActions table="income_transactions" id={i.id} paths={[...PATHS, src.href, "/property", "/financial/loans", "/financial/business"]}
          canDelete={canDelete && !whole} fields={fields} button={button}
          deleteControl={canDelete && whole && grp ? <UndoButton kind="PAYMENT" id={grp} label="ลบรายการนี้" size="md" paths={[...PATHS, src.href, "/financial/loans"]}
            confirmText={`ลบการรับชำระวันที่ ${thDate(i.date)}?\nเงินต้น ${money(loanPrincipal.get(grp))} + ดอกเบี้ย ${money(i.full_amount)} จะถูกลบพร้อมกัน\n(ถ้าผิดแค่ยอดดอกเบี้ย ให้แก้ยอดแล้วกดบันทึกแทน)`} /> : undefined} />
      );
    }
    return (
      <RowActions table="income_transactions" id={i.id} paths={PATHS} canDelete={canDelete} button={button} deleteEffect={incDeleteEffect(i)}
        editor={<EntryEditor kind="INCOME" id={i.id} currency={i.currency} banks={banks} persons={persons} subtypes={incSubs}
          accountEditable={!i.received_to_credit_card_id && !i.received_to_liability_id}
          personFallback={i.asset_id ? "ตามเจ้าของทรัพย์สิน" : undefined}
          values={{ date: i.date, amount: i.full_amount, tax: i.full_tax, person_id: i.person_id, notes: i.notes,
            income_type: i.income_type, income_subtype: i.income_subtype, bank: i.received_to_asset_id }} />} />
    );
  };
  /** แก้ไข / ลบ ค่าใช้จ่าย */
  const expEdit = (i: ExpFull, button?: string): ReactNode => {
    if (!canWrite || i.pending_split || fromCloseout(i.id)) return null;
    // ค่าธรรมเนียมโอน → หน้าต่างแก้การโอนต้นทาง (ค่าธรรมเนียมเป็นช่องหนึ่งของการโอน)
    if (i.source_cash_movement_id) {
      const m = moveById.get(i.source_cash_movement_id);
      return m ? moveEdit(m, { button, note: "ค่าธรรมเนียมนี้มาจากการโอนรายการนี้ · แก้ยอดค่าธรรมเนียมในช่องด้านล่าง",
        deleteNote: "ลบ = ลบการโอนทั้งรายการ (ค่าธรรมเนียมถูกลบตาม)\nถ้าผิดแค่ค่าธรรมเนียม ให้แก้ยอดค่าธรรมเนียมแล้วกดบันทึกแทน" }) : null;
    }
    // ค่าธรรมเนียมในพอร์ต (คูปอง / ปันผล / ดอกเบี้ย / รายการค่าธรรมเนียม) → แก้รายการในพอร์ตต้นทาง (ช่องเดียวกับหน้าพอร์ต)
    //   แลกเงิน / โอนระหว่างบัญชีในพอร์ต → แก้ที่หน้าพอร์ต (ลิงก์ที่ชื่อรายการ)
    if (i.source_investment_tx_id) {
      const tx = one(i.src_itx as Rec | Rec[] | null);
      if (!tx || tx.cash_movement_id || !["DIVIDEND", "INTEREST", "COUPON", "FEE"].includes(tx.transaction_type)) return null;
      const isFee = tx.transaction_type === "FEE";
      return (
        <RowActions table="investment_transactions" id={tx.id} paths={[...PATHS, "/investments", ...(i.related_asset_id ? [`/investments/${i.related_asset_id}`] : [])]}
          canDelete={canDelete && isFee} button={button}
          deleteNote="ลบรายการค่าธรรมเนียมในพอร์ต · รายจ่ายนี้ถูกลบตาม"
          fields={[
            { name: "transaction_date", label: "วันที่", type: "date", value: tx.transaction_date },
            ...(isFee ? [{ name: "amount", label: "ค่าธรรมเนียม", type: "number" as const, value: tx.amount }]
              : [{ name: "fee", label: "ค่าธรรมเนียม", type: "number" as const, value: tx.fee }]),
            { name: "notes", label: "หมายเหตุ", value: tx.notes, width: "w-40" }]} />
      );
    }
    // ดอกเบี้ยจ่ายเงินกู้ภายในครอบครัว (ฝั่งผู้กู้) → แก้ดอกเบี้ยที่รับของผู้ให้กู้ (ฝั่งผู้กู้เปลี่ยนตาม)
    if (i.internal_loan_income_id) {
      const inc = c.incById.get(i.internal_loan_income_id);
      return inc ? incEdit(full(inc), button) : null;
    }
    const src = expSource(i);
    if (src) {
      const fields = sourceEdit(i);
      if (!fields) return null;
      const grp = i.liability_id ? expGroup.get(i.id) : undefined;
      const whole = !!(grp && groupPrincipal.has(grp));
      return (
        <RowActions table="expense_items" id={i.id} paths={[...PATHS, src.href.split("?")[0], "/liabilities", "/property", "/insurance"]}
          canDelete={canDelete && !whole} fields={fields} button={button}
          deleteControl={canDelete && whole && grp ? <UndoButton kind="PAYMENT" id={grp} label="ลบรายการนี้" size="md" paths={[...PATHS, src.href, "/liabilities"]}
            confirmText={`ลบการจ่ายวันที่ ${thDate(i.date)}?\nเงินต้น ${money(groupPrincipal.get(grp))} + ดอกเบี้ย ${money(i.full_amount)} จะถูกลบพร้อมกัน\n(ถ้าผิดแค่ยอดดอกเบี้ย ให้แก้ยอดแล้วกดบันทึกแทน)`} /> : undefined} />
      );
    }
    return (
      <RowActions table="expense_items" id={i.id} paths={PATHS} canDelete={canDelete} button={button} deleteEffect={expDeleteEffect(i)}
        editor={<EntryEditor kind="EXPENSE" id={i.id} currency={i.currency} banks={banks} cards={cards} pfCash={c.pfCash} persons={persons}
          categories={expCats} reimbursable={!!i.is_reimbursable} properties={c.properties}
          values={{ date: i.date, amount: i.full_amount, description: i.description, category: i.expense_category, property_cost_type: i.property_cost_type, related_asset_id: i.related_asset_id,
            person_id: i.person_id, notes: i.notes, expected_reimbursement_amount: i.expected_reimbursement_amount,
            bank: i.paid_from_asset_id, card: i.paid_from_credit_card_id, hold: i.paid_from_cash_holding_id }} />} />
    );
  };
  /** แยกก้อนรอแยก: ปุ่ม (ตาราง) หรือกดที่แถว (ตารางเงินเข้า–ออก) */
  /** แยกก้อนในหน้านี้ = 4 ตัวเลือก (รายได้ · ค่าใช้จ่าย · โอนเข้า / ออกบัญชี · ตกลง 9 พ.ย. 2026)
   *   ก้อนบัญชีธนาคาร = ครบ 4 · ก้อนบัตร = รายได้ / ค่าใช้จ่าย · ก้อนหนี้ = ฝั่งเดียวกับก้อน (ฐานข้อมูลไม่รับฝั่งตรงข้าม) · จ่ายบัตร / หนี้ ไปบันทึกที่ต้นทาง */
  const sidesOf = (l: { currency: string; bank?: string | null; card?: string | null }): SplitSides => ({
    opposite: !!(l.bank || l.card),
    transfers: l.bank ? banks.filter((b) => b.currency === l.currency && b.asset_id !== l.bank).map((b) => ({ id: b.asset_id, name: b.name })) : [],
  });
  const incSplit = (i: IncFull, rowClick = false) => canWrite && canDelete && i.pending_split ? (
    <SplitForm key={`${i.id}-${i.full_amount}`} kind="INCOME" id={i.id} amount={Number(i.full_amount)} currency={i.currency} persons={persons}
      categories={expCats} hints={expHints} label="แยกรายละเอียด" rowClick={rowClick} buttonCls={SPLIT_BTN}
      personDefault={i.received_to_liability_id ? "ตามผู้รับผิดชอบหนี้" : i.received_to_credit_card_id ? "ตามเจ้าของบัตร" : "ตามเจ้าของบัญชี"}
      sides={sidesOf({ currency: i.currency, bank: i.received_to_asset_id, card: i.received_to_credit_card_id })} />
  ) : null;
  const expSplit = (i: ExpFull, rowClick = false) => canWrite && canDelete && i.pending_split ? (
    <SplitForm key={`${i.id}-${i.full_amount}`} kind="EXPENSE" id={i.id} amount={Number(i.full_amount)} currency={i.currency} persons={persons} categories={expCats}
      label="แยกรายละเอียด" rowClick={rowClick} buttonCls={SPLIT_BTN}
      personDefault={i.liability_id ? "ตามผู้รับผิดชอบหนี้" : i.paid_from_credit_card_id ? "ตามเจ้าของบัตร" : "ตามเจ้าของบัญชี"} hints={expHints}
      sides={sidesOf({ currency: i.currency, bank: i.paid_from_asset_id, card: i.paid_from_credit_card_id })} />
  ) : null;

  // กดที่รายละเอียดเพื่อไปหน้าต้นทาง (ขีดเส้นใต้ · เมาส์เป็นรูปมือ)
  const srcLink = (l: { href: string; label: string; tab?: string } | null, text: ReactNode) => {
    if (!l || !text) return text;
    return l.tab ? <TabLink tab={l.tab} href={l.href} className={NAME_LINK}>{text}</TabLink>
      : <Link href={l.href} title={`แก้ที่หน้า${l.label}`} className={NAME_LINK}>{text}</Link>;
  };
  const tabLink = (tab: string, label: string) => (c.tabLinks
    ? { href: `/income-expenses?tab=${tab}&m=${ym}${personId ? `&p=${personId}` : ""}`, label, tab } : null);

  /** รับชำระเงินให้กู้ครั้งเดียว (เงินต้น + ดอกเบี้ย รวมเป็นแถวเดียว) → หน้าต่างแก้ทั้งคู่ (PairEdit) · ไม่ครบคู่ = แถวกดไม่ได้ */
  const pairEdit = (m: Move): ReactNode => {
    const p = m.parts?.find((x) => x.movement_type === "LOAN_PRINCIPAL_RECEIPT" && !x.is_derived);
    const im = m.parts?.find((x) => x.is_derived && x.source_entity_type === "INCOME" && x.source_entity_id);
    const inc = im?.source_entity_id ? c.incById.get(im.source_entity_id) : undefined;
    if (!canWrite || !p || !inc || inc.pending_split || !m.movement_group_id || m.parts?.length !== 2) return null;
    const loan = p.from_asset_id;
    return (
      <PairEdit group={m.movement_group_id} canDelete={canDelete} direction="IN" currency={m.currency}
        paths={[...PATHS, loan ? `/financial/loans/${loan}` : "/financial/loans", "/financial/loans"]}
        principal={{ id: p.id, date: p.movement_date, amount: Number(p.amount) }}
        interest={{ table: "income_transactions", id: inc.id, date: inc.date, amount: Number(inc.amount), tax: inc.tax == null ? null : Number(inc.tax) }}
        confirmText={`ลบการรับชำระวันที่ ${thDate(p.movement_date)}?\nเงินต้น ${money(p.amount)} + ดอกเบี้ย ${money(inc.amount)} จะถูกลบพร้อมกัน\n(ถ้าผิดแค่ยอด ให้แก้ยอดแล้วกดบันทึกแทน)`} />
    );
  };

  const dateField = (m: Move) => ({ name: "movement_date", label: "วันที่", type: "date" as const, value: m.movement_date });
  /** ซื้อ / ขายทรัพย์สิน → ฟอร์มเดียวกับหน้าทรัพย์สิน (ตกลง 9 พ.ย. 2026)
   *   Property จ่ายซื้อ / จ่ายเพิ่ม = ฟอร์มรายการจ่าย (แถวของ Property) · Alternative = วันที่ / ยอด / รายละเอียด · ขาย = ลบได้อย่างเดียว (เหมือนหน้าทรัพย์สิน)
   *   กิจการ = วันที่ / ยอด (เหมือนหน้ากิจการ) · ซื้อ / ขายหุ้น · ขายบางส่วน → ลิงก์ (แก้ / ยกเลิกที่หน้าต้นทาง)
   *   ถอนมูลค่าเวนคืน → หน้าต่างแก้รายการรับเงินประกัน */
  const assetMoveEdit = (m: Move): ReactNode => {
    if (!canWrite || m.is_derived) return null;
    const meta = (m.metadata ?? {}) as AssetMeta;
    if (meta.policy_id) return receiptEdit(rcByMove.get(m.id));
    if (meta.share_sale || meta.share_buy || meta.part_sale) return null;
    const assetId = m.movement_type === "ASSET_PURCHASE" ? m.to_asset_id : m.from_asset_id;
    const a = assetId ? assetById.get(assetId) : undefined;
    const src = assetLink(m);
    const paths = [...PATHS, ...(src ? [src.href.split("?")[0]] : []), "/property", "/alternative", "/financial/business"];
    const amt = { name: "amount", label: "จำนวน", type: "number" as const, value: m.amount };
    if (a?.asset_type === "PRIVATE_BUSINESS") return <RowActions table="cash_movements" id={m.id} paths={paths} canDelete={canDelete} fields={[dateField(m), amt]} />;
    if (m.movement_type === "ASSET_SALE") return canDelete ? (
      <RowActions table="cash_movements" id={m.id} paths={paths} canEdit={false} canDelete
        deleteNote="ลบเฉพาะเงินขายที่เข้าบัญชี — สถานะ / มูลค่าราคาขาย ต้องแก้เองที่หน้าทรัพย์สิน" fields={[]} />) : null;
    const editor = a?.asset_group === "PROPERTY" && assetId ? (
      <PropertyPaymentForm assetId={assetId} currency={m.currency} paths={paths} addedValue={meta.add_value === true} components={compsOf(assetId)}
        m={{ id: m.id, movement_date: m.movement_date, amount: Number(m.amount), description: m.description, component_id: meta.component_id ?? null }} />) : undefined;
    return (
      <RowActions table="cash_movements" id={m.id} paths={paths} canDelete={canDelete} editor={editor}
        fields={[dateField(m), amt, { name: "description", label: "รายละเอียด", value: m.description, width: "w-40" }]} />
    );
  };
  /** รับคืนเงินต้นอย่างเดียว (ไม่มีดอกเบี้ยคู่) → ช่องเดียวกับหน้า Loans */
  const principalEdit = (m: Move): ReactNode => (canWrite ? (
    <RowActions table="cash_movements" id={m.id} paths={[...PATHS, m.from_asset_id ? `/financial/loans/${m.from_asset_id}` : "/financial/loans", "/financial/loans"]}
      canDelete={canDelete} fields={[dateField(m), { name: "amount", label: "เงินต้น", type: "number", value: m.amount }]} />) : null);
  /** ซื้อ / ขาย / ไถ่ถอนในพอร์ตที่ตัด / เข้าบัญชีธนาคารตรง → ช่องเดียวกับตารางรายการในหน้าพอร์ต */
  const itxEdit = (m: Move): ReactNode => {
    const t = m.source_entity_id ? itxById.get(m.source_entity_id) : undefined;
    if (!canWrite || !t || t.cash_movement_id || t.source_expense_item_id) return null;
    const pf = m.movement_type === "INVESTMENT_OUT" ? m.to_asset_id : m.from_asset_id;
    return (
      <RowActions table="investment_transactions" id={t.id} paths={[...PATHS, pf ? `/investments/${pf}` : "/investments", "/investments"]} canDelete={canDelete}
        deleteNote="รายได้ / เงินเข้าออกบัญชีที่ระบบสร้างจากรายการนี้จะถูกลบตาม" fields={portfolioTxFields(t, true)} />
    );
  };
  /** ฝั่งผู้กู้ของเงินกู้ภายในครอบครัว → แก้รายการฝั่งผู้ให้กู้ (ฝั่งผู้กู้เปลี่ยนตาม) · ไม่อยู่ในรายการของหน้านี้ = ลิงก์ */
  const mergedByPart = new Map(mergeGroups(c.moves).filter((x) => x.parts).flatMap((x) => (x.parts ?? []).map((p) => [p.id, x] as [string, Move])));
  const borrowerEdit = (m: Move): ReactNode => {
    const src = m.source_entity_id ? moveById.get(m.source_entity_id) : undefined;
    if (!src) return null;
    if (src.movement_type === "LOAN_DISBURSEMENT") return moveEdit(src);
    if (src.movement_type === "LOAN_PRINCIPAL_RECEIPT") { const g = mergedByPart.get(src.id); return g ? pairEdit(g) : principalEdit(src); }
    return null;
  };

  /** แถวของตารางเงินเข้า–ออก · withActions = กดที่แถวเพื่อแก้ไข / แยกก้อน */
  // เบี้ยประกันเล่มเดียวกันที่จ่ายพร้อมกัน (ค่าใช้จ่ายมี payment_group_id ตรงกับชุดของเงินออก) → รวมเป็นแถวเดียว
  const premOf = (m: Move) => (m.is_derived && m.source_entity_type === "EXPENSE" && m.source_entity_id ? c.expById.get(m.source_entity_id) : undefined);
  const premPart = (m: Move) => { const e = premOf(m); return !!e && !!e.insurance_schedule_line_id && !!e.payment_group_id && e.payment_group_id === m.movement_group_id; };
  const buildMoveRows = (list: Move[], withActions: boolean): MoveRow[] => mergeGroups(list, premPart).map((m) => {
    let detail: ReactNode = m.description;
    let link: { href: string; label: string; tab?: string } | null = null;
    let type = MOVE_LABEL[m.movement_type] ?? m.movement_type;
    let pending = false;
    let breakdown: ReactNode = null;
    const premSet = !!m.parts && m.parts.every(premPart);
    if (m.parts && premSet) {
      // ทั้งเล่ม: ชื่อกรมธรรม์ + ยอดแยกทีละส่วน (ชีวิต 1,402.00 + สุขภาพ 730.00) · แก้ทีละส่วนที่หน้ากรมธรรม์
      type PremLine = { policy_id: string; installment_no: number; pol: { insurance_type: string; insurer: string; policy_no: string | null } | null };
      const lineOf = (x: Move) => one(premOf(x)?.ins_line as PremLine | PremLine[] | null);
      const typeOf = (l: PremLine | null) => one(l?.pol ?? null)?.insurance_type ?? "";
      // รายการหลักก่อน (ชีวิต → อุบัติเหตุ → สุขภาพ → ทรัพย์สิน) ตามลำดับในเล่ม
      const ps = m.parts.map((x) => ({ x, l: lineOf(x) })).sort((a, b) => partRank(typeOf(a.l)) - partRank(typeOf(b.l)));
      const mainLine = ps.find((q) => q.l)?.l ?? null;
      const pol = one(mainLine?.pol ?? null);
      detail = pol ? `เบี้ยประกัน ${pol.insurer.trim()}${pol.policy_no ? ` ${pol.policy_no}` : ""} · ทั้งเล่ม` : m.description;
      // ยอดของแต่ละส่วน: กดที่ยอดเพื่อแก้ / ลบรายการนั้น (แบบหน้ากรมธรรม์)
      breakdown = <div className="text-xs text-slate-500">{ps.map(({ x, l }, i) => {
        const e = premOf(x);
        return <span key={x.id}>{i > 0 && " + "}{INS_PART_LABEL[typeOf(l)] ?? `ส่วนที่ ${i + 1}`}{" "}
          {withActions && canWrite && e ? <RowActions table="expense_items" id={e.id} paths={[...PATHS, l ? `/insurance/${l.policy_id}` : "/insurance", "/insurance"]}
            canDelete={canDelete} fields={premiumPaymentFields(e as { date: string; amount: number; notes: string | null })} button={money(x.amount)} buttonClass={AMT} /> : money(x.amount)}</span>;
      })}</div>;
      link = mainLine ? { href: `/insurance/${mainLine.policy_id}?tab=flow`, label: "กรมธรรม์ (แก้ทีละส่วน)" } : null;
    } else if (m.parts) {
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
    } else if (m.is_derived && m.source_entity_type === "CASH_MOVEMENT") {      // ฝั่งผู้กู้ของเงินกู้ภายในครอบครัว
      type = m.movement_type === "OTHER_IN" ? "รับเงินกู้ภายใน" : "ชำระเงินกู้ภายใน";
      const loan = (m.metadata as { internal_loan_asset_id?: string } | null | undefined)?.internal_loan_asset_id;
      link = { href: loan ? `/financial/loans/${loan}` : "/financial/loans", label: "เงินกู้ภายในครอบครัว" };
    } else if (m.is_derived && m.source_entity_type === "INVESTMENT_TX") {
      const pf = [m.from_asset_id, m.to_asset_id].find((x) => x && assetType.get(x) === "INVESTMENT_PORTFOLIO");
      link = { href: pf ? `/investments/${pf}` : "/investments", label: "พอร์ตลงทุน" };
    } else if (m.is_derived) {
      link = null;
    }
    // แก้ที่นี่ไม่ได้ / มาจากหน้าอื่น → กดชื่อไปหน้าต้นทาง (ตกลง 9 พ.ย. 2026)
    if (!link && !m.parts && !m.is_derived) {
      if (m.movement_type === "ASSET_PURCHASE" || m.movement_type === "ASSET_SALE") link = assetLink(m);
      else if (m.movement_type === "LOAN_PRINCIPAL_RECEIPT" && m.from_asset_id) link = { href: `/financial/loans/${m.from_asset_id}`, label: "เงินให้กู้" };
      else if (m.movement_type === "LOAN_DISBURSEMENT" && m.to_asset_id) link = { href: `/financial/loans/${m.to_asset_id}`, label: "เงินให้กู้" };
      else if (DEPOSIT_MOVES.includes(m.movement_type)) {
        // สัญญาเช่า → property_details → asset_id (property_leases ไม่มีคอลัมน์ property_asset_id)
        type PD = { asset_id: string };
        const pa = one(one(m.lease as { pd: PD | PD[] | null } | { pd: PD | PD[] | null }[] | null)?.pd ?? null)?.asset_id;
        link = { href: pa ? `/property/${pa}` : "/property", label: "สัญญาเช่า" };
        // ข้อความเดิมในฐานข้อมูล "รับเงินประกัน · ผู้เช่า" → แสดงเต็มคำ (ไม่สับสนกับเงินประกันชีวิต)
        if (typeof detail === "string") detail = detail.replace(/^(รับ|คืน)เงินประกัน(?!การเช่า)/, "$1เงินประกันการเช่า");
      }
    }
    // ป้ายตามเมนูต้นทาง (ซื้อ / ขาย Property · เงินประกัน · ซื้อหลักทรัพย์ · เงินกู้ภายใน ฯลฯ)
    const srcAsset = m.movement_type === "ASSET_PURCHASE" ? m.to_asset_id : m.movement_type === "ASSET_SALE" ? m.from_asset_id : null;
    const source = m.parts ? null : sourceMeta(m, srcAsset ? assetById.get(srcAsset) : null);
    if (source) type = source.label;
    const counter = m.counter_amount != null ? Number(m.counter_amount) : Number(m.amount);
    const inc = m.is_derived && m.source_entity_type === "INCOME" && m.source_entity_id ? c.incById.get(m.source_entity_id) : undefined;
    const exp = m.is_derived && m.source_entity_type === "EXPENSE" && m.source_entity_id ? c.expById.get(m.source_entity_id) : undefined;
    const txInc = m.is_derived && m.source_entity_type === "INVESTMENT_TX" && m.source_entity_id ? incByTx.get(m.source_entity_id) : undefined;
    return {
      key: m.id, date: m.movement_date, type, typeCls: m.movement_type === "REIMBURSEMENT_IN" ? "text-sky-700" : undefined,
      kind: m.movement_type, merged: !!m.parts && !premSet, fee: Number(m.fee ?? 0),
      metaOpts: { incomeType: inc?.income_type ?? null, incomeSubtype: inc?.income_subtype ?? null,
        expenseCategory: exp?.expense_category ?? null, pending: !!(inc?.pending_split || exp?.pending_split), source },
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
      detail: <>{srcLink(link, (pending && typeof detail === "string" ? stripPending(detail) : detail) || type)}{breakdown}
        {canWrite && (inc || exp) && fromCloseout((inc ?? exp)!.id) && CLOSEOUT_NOTE}
        {canWrite && DEPOSIT_MOVES.includes(m.movement_type) && DEPOSIT_NOTE}</>,
      actions: premSet ? null
        : withActions && !m.parts && !m.is_derived && EDITABLE_MOVES.includes(m.movement_type) ? moveEdit(m)
        // รับชำระเงินให้กู้ (เงินต้น + ดอกเบี้ย) → กดที่แถว: หน้าต่างเดียวแก้ทั้งคู่ (เหมือนหน้า Loans)
        : withActions && m.parts ? pairEdit(m)
        // เงินเข้าบัญชีจากปันผล / ดอกเบี้ย / คูปองในพอร์ต → แก้รายการในพอร์ต
        : withActions && txInc ? incEdit(full(txInc))
        // ซื้อ / ขายทรัพย์สิน · ถอนมูลค่าเวนคืน · รับคืนเงินต้นอย่างเดียว · ซื้อ / ขายในพอร์ตผ่านบัญชี · ฝั่งผู้กู้ภายใน → ฟอร์มของหน้าต้นทาง
        : withActions && !m.parts && (m.movement_type === "ASSET_PURCHASE" || m.movement_type === "ASSET_SALE") ? assetMoveEdit(m)
        : withActions && !m.parts && !m.is_derived && m.movement_type === "LOAN_PRINCIPAL_RECEIPT" ? principalEdit(m)
        : withActions && m.is_derived && m.source_entity_type === "INVESTMENT_TX" ? itxEdit(m)
        : withActions && m.is_derived && m.source_entity_type === "CASH_MOVEMENT" ? borrowerEdit(m)
        // เงินเข้า–ออกจากรายได้ / ค่าใช้จ่าย → กดที่แถว: แก้ไข (ฟอร์มชุดเดียวกับแท็บรายได้ / ค่าใช้จ่าย) หรือแยกก้อนรอแยก
        //   แก้ที่นี่ไม่ได้ (ซื้อ / ขายในพอร์ต / เงินประกัน / ฝั่งผู้กู้ ฯลฯ) → แถวกดไม่ได้ · กดชื่อไปหน้าต้นทาง
        : withActions && inc && !m.parts ? (inc.pending_split ? incSplit(full(inc), true) : incEdit(full(inc)))
        : withActions && exp ? (exp.pending_split ? expSplit({ ...exp, full_amount: Number(exp.amount) }, true)
            : expEdit({ ...exp, full_amount: Number(exp.amount) }))
        : null,
    };
  });

  /** ใต้ชื่อรายการ: มาจากผู้เช่าออก (ผู้มีสิทธิ์เขียนเท่านั้น · ผู้ดูอย่างเดียวกดแก้อะไรไม่ได้อยู่แล้ว) */
  const closeoutNote = (id: string): ReactNode => (canWrite && fromCloseout(id) ? CLOSEOUT_NOTE : null);

  return { incSource, expSource, incEdit, expEdit, incSplit, expSplit, buildMoveRows, closeoutNote, name, placeOf, bankIds };
}
