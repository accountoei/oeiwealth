import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { LIABILITY_TYPE_LABEL, money, thDate, todayBangkok } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import { HeaderFilters } from "@/components/HeaderBar";
import { ActionBar } from "@/components/ActionBar";
import { MoveButtons, SortToggle, neighbors } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";
import { CardBalanceForm } from "./cards/forms";
import { StatBox } from "@/components/Boxes";
import { TabNav, TabPanel, TabsProvider } from "@/components/ClientTabs";
import PayBatch, { type DebtRow } from "./PayBatch";
import { recEdit, recLabel, recLink, wholeUndo, type Recorded } from "@/lib/recorded-edit";
import { debtInterestFields } from "@/lib/source-edit";

type Row = { liability_source: string; source_id: string; name: string; subtype: string; currency: string;
  amount: number | null; balance_date: string | null; due_date: string | null; monthly_payment: number | null;
  payment_due_day: number | null; status: string; derived_status: string | null };

type Card = { id: string; person_id: string; issuer: string; card_name: string | null; card_last4: string | null;
  credit_limit: number | null; currency: string; statement_day: number | null; due_day: number | null;
  outstanding_balance: number; balance_date: string | null; status: string; autopay_asset_id: string | null; autopay_cash_holding_id: string | null; autopay_mode: string | null;
  persons: { name: string } | { name: string }[] | null };

const SOURCE_LABEL: Record<string, string> = { LOAN: "เงินกู้", SECURITY_DEPOSIT: "เงินประกันการเช่า" };
const DERIVED: Record<string, { text: string; cls: string }> = {
  DEPOSIT_REFUND_OVERDUE: { text: "เลยกำหนดคืนเงินประกัน", cls: "text-red-600" },
  DUE_SOON: { text: "ใกล้ครบกำหนดคืน", cls: "text-amber-700" },
  HELD: { text: "ถือไว้", cls: "text-slate-500" },
};
const CARD_STATUS: Record<string, string> = { ACTIVE: "", SUSPENDED: "ระงับชั่วคราว", CLOSED: "ยกเลิกแล้ว" };
const TABS = [["overview", "ภาพรวม"], ["pay", "จ่ายชำระเงินกู้/บัตรเครดิต"]] as const;

export default async function LiabilitiesPage({ searchParams }: { searchParams: Promise<{ p?: string; order?: string; tab?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder ? sp.order ?? "" : "";        // "1" = เงินกู้ · "cards" = บัตร
  const paths = ["/liabilities"];
  const [pv, { data, error }, loanOrder, { data: cardsRaw }, { data: cardBal }, { data: family }, { data: banksRaw }, { data: odRaw }, { data: balRaw }] = await Promise.all([
    loadPersonView(sp.p, { liabilities: true }),
    supabase.from("v_liabilities_all").select("*").order("liability_source").order("name"),
    loadSortMap("liabilities"),
    supabase.from("credit_cards").select("id,person_id,issuer,card_name,card_last4,credit_limit,currency,statement_day,due_day,outstanding_balance,balance_date,status,autopay_asset_id,autopay_cash_holding_id,autopay_mode,persons(name)")
      .is("deleted_at", null).order("sort_order").order("issuer"),
    supabase.from("v_card_balances").select("card_id,current_balance"),
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,status"),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,bank_name,status,overdraft_limit,overdraft_rate").not("overdraft_limit", "is", null).order("name"),
    supabase.rpc("bank_balances_at", { p_date: todayBangkok() }),
  ]);
  // มุมมองรายบุคคล: เฉพาะหนี้ที่คนนั้นมีส่วน · ยอด × สัดส่วน (เงินกู้ตามผู้รับผิดชอบ · บัตรตามเจ้าของบัตร · เงินประกันตามเจ้าของทรัพย์)
  const all = ((data as Row[] | null) ?? []).filter((r) => pv.showLiability(r.source_id))
    .map((r) => ({ ...r, full_amount: r.amount, pct: pv.liabilityPct(r.source_id),
      amount: r.amount == null ? null : Number(r.amount) * pv.liabilityShare(r.source_id) }));
  const totals = new Map<string, number>();
  all.forEach((r) => totals.set(r.currency, (totals.get(r.currency) ?? 0) + Number(r.amount ?? 0)));
  // เงินเบิกเกินบัญชี (O/D): บัญชีกระแสรายวันที่มีวงเงิน · ใช้ไป = ยอดติดลบ (ส่วนของสมาชิกที่เลือก = ตามเจ้าของบัญชี)
  const calc = new Map(((balRaw as { asset_id: string; calculated: number | null }[] | null) ?? []).map((r) => [r.asset_id, r.calculated == null ? null : Number(r.calculated)]));
  const ods = ((odRaw as { asset_id: string; name: string; currency: string; bank_name: string; status: string; overdraft_limit: number; overdraft_rate: number | null }[] | null) ?? [])
    .filter((o) => pv.showAsset(o.asset_id) && (o.status === "ACTIVE" || (calc.get(o.asset_id) ?? 0) < 0))
    .map((o) => {
      const bal = calc.get(o.asset_id) ?? null, share = pv.assetShare(o.asset_id);
      return { ...o, bal, limit: Number(o.overdraft_limit) * share, used: Math.max(-(bal ?? 0), 0) * share };
    });
  ods.forEach((o) => { if (o.used > 0) totals.set(o.currency, (totals.get(o.currency) ?? 0) + o.used); });
  const odUsed = ods.reduce((t, o) => t + (o.currency === "THB" ? o.used : 0), 0);
  const odLimit = ods.reduce((t, o) => t + (o.currency === "THB" ? o.limit : 0), 0);
  // เงินกู้ (ตามลำดับที่ตั้งไว้) → เงินประกันการเช่า
  const rows = all.filter((r) => r.liability_source !== "CREDIT_CARD").map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.liability_source === "LOAN" ? 0 : 1) - (b.r.liability_source === "LOAN" ? 0 : 1)
      || (loanOrder.get(a.r.source_id) ?? Number.MAX_SAFE_INTEGER) - (loanOrder.get(b.r.source_id) ?? Number.MAX_SAFE_INTEGER) || a.i - b.i)
    .map((x) => x.r);
  const loans = rows.filter((r) => r.liability_source === "LOAN");

  const cur = new Map((cardBal ?? []).map((r) => [r.card_id as string, Number(r.current_balance)]));
  const cards = ((cardsRaw as Card[] | null) ?? []).filter((c) => pv.isPerson(c.person_id));
  const curOf = (c: Card) => cur.get(c.id) ?? Number(c.outstanding_balance);
  const holder = (c: Card) => (Array.isArray(c.persons) ? c.persons[0]?.name : c.persons?.name) ?? "-";
  const bankName = new Map((banksRaw ?? []).map((b) => [b.asset_id as string, b.name as string]));
  const canWrite = me.role !== "VIEWER";
  const today = todayBangkok();
  const isSetup = family?.system_status === "SETUP";
  const goLive = family?.go_live_date ?? "";
  const minDate = isSetup ? "" : goLive;
  // สรุปด้านบน (THB) · ยอดตามสัดส่วนของสมาชิกที่เลือก
  const thbSum = (xs: { amount: number | null; currency: string }[]) => xs.reduce((t, r) => t + (r.currency === "THB" ? Number(r.amount ?? 0) : 0), 0);
  const loanTotal = thbSum(loans);
  const depRows = rows.filter((r) => r.liability_source === "SECURITY_DEPOSIT");
  const depTotal = thbSum(depRows);
  const openCards = cards.filter((c) => c.status !== "CLOSED");
  const cardTotal = openCards.reduce((t, c) => t + (c.currency === "THB" ? curOf(c) : 0), 0);
  const cardLimit = openCards.reduce((t, c) => t + (c.currency === "THB" ? Number(c.credit_limit ?? 0) : 0), 0);
  const monthly = loans.reduce((t, r) => t + (r.currency === "THB" ? Number(r.monthly_payment ?? 0) * pv.liabilityShare(r.source_id) : 0), 0);

  // แท็บจ่ายชำระทั้งชุด: เงินกู้ที่ยังผ่อน (ยอดเต็ม) + บัตรที่ใช้งาน
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as string) : "overview";
  const payBanks = (banksRaw ?? []).filter((b) => b.status === "ACTIVE").map((b) => ({ id: b.asset_id as string, name: b.name as string, currency: b.currency as string }));
  // จ่ายแล้วเดือนนี้ (ทีละครั้ง) → กดเพื่อแก้ / ลบ · จ่ายครั้งเดียวกัน (เงินต้น + ดอกเบี้ย) ลบทั้งก้อน (ตกลง 28 ต.ค. 2026)
  const mStart = `${today.slice(0, 7)}-01`;
  const loanIds = loans.filter((r) => r.status === "ACTIVE").map((r) => r.source_id), cardIds = cards.filter((c) => c.status === "ACTIVE").map((c) => c.id);
  const noRows = Promise.resolve({ data: [] as never[] });
  const [{ data: lPays }, { data: lInts }, { data: cPays }] = await Promise.all([
    loanIds.length ? supabase.from("cash_movements").select("id,to_liability_id,movement_date,amount,currency,movement_group_id,is_derived")
      .eq("movement_type", "LIABILITY_PAYMENT").in("to_liability_id", loanIds).gte("movement_date", mStart).is("deleted_at", null).order("movement_date") : noRows,
    loanIds.length ? supabase.from("expense_items").select("id,liability_id,date,amount,currency,notes").in("liability_id", loanIds).eq("pending_split", false)
      .not("paid_from_asset_id", "is", null).gte("date", mStart).is("deleted_at", null).order("date") : noRows,
    cardIds.length ? supabase.from("cash_movements").select("id,to_credit_card_id,movement_date,amount,currency,is_derived")
      .eq("movement_type", "CARD_PAYMENT").in("to_credit_card_id", cardIds).gte("movement_date", mStart).is("deleted_at", null).order("movement_date") : noRows,
  ]);
  type PM = { id: string; to_liability_id: string; movement_date: string; amount: number; currency: string; movement_group_id: string | null; is_derived: boolean };
  type PI = { id: string; liability_id: string; date: string; amount: number; currency: string; notes: string | null };
  type CP = { id: string; to_credit_card_id: string; movement_date: string; amount: number; currency: string; is_derived: boolean };
  const lIntIds = ((lInts ?? []) as PI[]).map((e) => e.id);
  const { data: lIntMv } = lIntIds.length ? await supabase.from("cash_movements").select("source_entity_id,movement_group_id")
    .eq("source_entity_type", "EXPENSE").in("source_entity_id", lIntIds).is("deleted_at", null) : { data: [] as { source_entity_id: string; movement_group_id: string | null }[] };
  const intGroup = new Map((lIntMv ?? []).map((m) => [m.source_entity_id as string, m.movement_group_id as string | null]));
  const loanEdits = (lid: string): Recorded[] => {
    const lp = ["/liabilities", `/liabilities/${lid}`, "/income-expenses"];
    const ps = ((lPays ?? []) as PM[]).filter((m) => m.to_liability_id === lid), is = ((lInts ?? []) as PI[]).filter((e) => e.liability_id === lid);
    const both = (g: string | null | undefined) => !!g && ps.some((m) => m.movement_group_id === g) && is.some((e) => intGroup.get(e.id) === g);
    const undo = (g: string, d: string) => canOrder ? wholeUndo(g, lp, `ยกเลิกการจ่ายวันที่ ${thDate(d)} ทั้งก้อน?\nเงินต้น + ดอกเบี้ยของครั้งนี้จะถูกลบพร้อมกัน`) : undefined;
    return [
      ...ps.map((m) => ({ d: m.movement_date, x: { id: m.id, node: m.is_derived ? recLink(recLabel("เงินต้น", m.movement_date, Number(m.amount), m.currency), `/liabilities/${lid}`)
        : recEdit({ canWrite, canDelete: canOrder && !both(m.movement_group_id), table: "cash_movements", id: m.id, paths: lp,
          label: recLabel("เงินต้น", m.movement_date, Number(m.amount), m.currency), extra: both(m.movement_group_id) ? undo(m.movement_group_id!, m.movement_date) : undefined,
          fields: [{ name: "movement_date", label: "วันที่", type: "date", value: m.movement_date }, { name: "amount", label: "เงินต้น", type: "number", value: m.amount }] }) } })),
      ...is.map((e) => ({ d: e.date, x: { id: e.id, node: recEdit({ canWrite, canDelete: canOrder && !both(intGroup.get(e.id)), table: "expense_items", id: e.id, paths: lp,
        label: recLabel("ดอกเบี้ย", e.date, Number(e.amount), e.currency), extra: both(intGroup.get(e.id)) ? undo(intGroup.get(e.id)!, e.date) : undefined,
        fields: debtInterestFields(e) }) } })),
    ].sort((a, b) => a.d.localeCompare(b.d)).map((y) => y.x);
  };
  const cardEdits = (cid: string): Recorded[] => ((cPays ?? []) as CP[]).filter((m) => m.to_credit_card_id === cid).map((m) => ({ id: m.id,
    node: m.is_derived ? recLink(recLabel("จ่ายแล้ว", m.movement_date, Number(m.amount), m.currency), `/liabilities/cards/${cid}`)
      : recEdit({ canWrite, canDelete: canOrder, table: "cash_movements", id: m.id, paths: ["/liabilities", `/liabilities/cards/${cid}`, "/income-expenses"],
        label: recLabel("จ่ายแล้ว", m.movement_date, Number(m.amount), m.currency),
        fields: [{ name: "movement_date", label: "วันที่จ่าย", type: "date", value: m.movement_date }, { name: "amount", label: "ยอด", type: "number", value: m.amount }] }) }));
  const debtRows: DebtRow[] = [
    ...loans.filter((r) => r.status === "ACTIVE").map((r): DebtRow => ({ key: `l${r.source_id}`, kind: "LOAN", id: r.source_id, href: `/liabilities/${r.source_id}`,
      name: r.name, sub: LIABILITY_TYPE_LABEL[r.subtype] ?? null, currency: r.currency, balance: Number(r.full_amount ?? 0),
      monthly: r.monthly_payment != null ? Number(r.monthly_payment) : null, dueDay: r.payment_due_day, autopay: false,
      defaultBank: payBanks.find((b) => b.currency === r.currency)?.id ?? "", edits: loanEdits(r.source_id) })),
    ...cards.filter((c) => c.status === "ACTIVE").map((c): DebtRow => ({ key: `c${c.id}`, kind: "CARD", id: c.id, href: `/liabilities/cards/${c.id}`,
      name: [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" "), sub: holder(c), currency: c.currency,
      balance: curOf(c), monthly: null, dueDay: c.due_day, autopay: !!c.autopay_asset_id,
      defaultBank: c.autopay_asset_id ?? payBanks.find((b) => b.currency === c.currency)?.id ?? "", edits: cardEdits(c.id) })),
  ];

  return (
    <TabsProvider initial={tab} defaultKey="overview">
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">หนี้สินทั้งหมด: เงินกู้ · บัตรเครดิต · เงินประกันการเช่า · เงินเบิกเกินบัญชี (O/D)</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <HeaderFilters><PersonFilter persons={pv.persons} value={pv.personId} /></HeaderFilters>
          {canWrite && (
            <ActionBar>
              <Link href="/liabilities/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มเงินกู้ / หนี้สิน</Link>
            </ActionBar>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      <div className="border-b border-slate-200"><TabNav tabs={TABS} /></div>

      <TabPanel id="pay">
        <PayBatch key={debtRows.map((r) => r.key).join()} rows={debtRows} banks={payBanks} today={today} minDate={minDate} canWrite={canWrite} />
      </TabPanel>

      <TabPanel id="overview" className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
          <div className="text-xs text-slate-500">{pv.personId ? `หนี้ส่วนของ ${pv.personName}` : "หนี้สินรวม"}</div>
          {[...totals.entries()].length === 0 ? <div className="mt-1 text-xl font-semibold tabular-nums">{money(0, "THB")}</div>
            : [...totals.entries()].map(([ccy, v]) => <div key={ccy} className="mt-1 text-xl font-semibold tabular-nums text-red-700">{money(v, ccy)}</div>)}
          <div className="text-xs text-slate-500">เงินกู้ + บัตรเครดิต + เงินประกันการเช่า{ods.length > 0 ? " + O/D" : ""}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
          <div className="text-xs text-slate-500">เงินกู้ ({loans.length} รายการ)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-red-700">{money(loanTotal, "THB")}</div>
          {monthly > 0 && <div className="text-xs text-slate-500">ค่างวดรวม {money(monthly)}/เดือน</div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
          <div className="text-xs text-slate-500">บัตรเครดิต ({openCards.length} ใบ)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-red-700">{money(cardTotal, "THB")}</div>
          {cardLimit > 0 && <div className="text-xs text-slate-500">ใช้ไป {((cardTotal * 100) / cardLimit).toFixed(1)}% ของวงเงิน {money(cardLimit, undefined, 0)}</div>}
        </div>
        <StatBox label={<>เงินประกันการเช่า ({depRows.length} สัญญา)</>} value={money(depTotal, "THB")} valueClass="text-red-700" sub="ต้องคืนผู้เช่าเมื่อหมดสัญญา" />
      </section>

      {/* บัตรเครดิตอยู่บนสุด (ตกลง 27 ต.ค. 2026) */}
      <div id="cards" className="scroll-mt-20 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex items-baseline justify-between gap-3 px-4 pt-4">
          <h2 className="font-medium text-slate-900">บัตรเครดิต</h2>
          {canOrder && cards.length > 1 && <SortToggle active={ordering === "cards"} {...orderHrefs("/liabilities", { p: sp.p }, "cards")} />}
        </div>
        <table className="mt-2 w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">บัตร</th><th className="px-4">ผู้ถือ</th><th className="px-4 text-right">ยอดค้าง</th>
              <th className="px-4">วงเงิน / รอบบิล</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cards.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">{pv.personId ? `ไม่มีบัตรเครดิตของ ${pv.personName}` : "ยังไม่มีบัตรเครดิต"}</td></tr>}
            {cards.map((c, i) => (
              <tr key={c.id} className={`align-top hover:bg-slate-50 ${c.status === "CLOSED" ? "opacity-50" : c.status === "SUSPENDED" ? "opacity-70" : ""}`}>
                <td className="px-4 py-3">
                  {ordering === "cards" && <div className="mb-1"><MoveButtons table="credit_cards" id={c.id} paths={paths} {...neighbors(cards, i, (x) => x.id)} /></div>}
                  <Link href={`/liabilities/cards/${c.id}`} className="font-medium text-slate-900 hover:underline">{c.issuer} {c.card_name}</Link>
                  <div className="text-xs text-slate-500">
                    {c.card_last4 ? `•••• ${c.card_last4}` : "ไม่ระบุเลขท้าย"} · {c.currency}
                    {CARD_STATUS[c.status] && <span className="text-amber-700"> · {CARD_STATUS[c.status]}</span>}
                  </div>
                </td>
                <td className="px-4 py-3">{holder(c)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="tabular-nums">{money(curOf(c), c.currency)}</div>
                  <div className="text-xs text-slate-500">
                    {Math.abs(curOf(c) - Number(c.outstanding_balance)) > 0.005
                      ? <>ตาม Statement {money(c.outstanding_balance)} ณ {thDate(c.balance_date)}<br />+ รูด − จ่าย หลังจากนั้น</>
                      : <>ตาม Statement ณ {thDate(c.balance_date)}</>}
                  </div>
                  {canWrite && c.status !== "CLOSED" && (
                    <CardBalanceForm cardId={c.id} currency={c.currency} today={today} minDate={minDate}
                      banks={(banksRaw ?? []).filter((b) => b.currency === c.currency && b.status === "ACTIVE") as { asset_id: string; name: string }[]} />
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {c.credit_limit ? `วงเงิน ${money(c.credit_limit)}` : "-"}
                  {c.statement_day ? <div>ตัดรอบวันที่ {c.statement_day}</div> : null}
                  {c.due_day ? <div>ชำระภายในวันที่ {c.due_day}</div> : null}
                  {(c.autopay_asset_id || c.autopay_cash_holding_id) && (
                    <div className="mt-1 text-emerald-700">
                      ตัดบัญชีอัตโนมัติ{c.autopay_mode === "MINIMUM" ? "ขั้นต่ำ" : "เต็มจำนวน"} จาก {c.autopay_asset_id ? bankName.get(c.autopay_asset_id) ?? "บัญชี" : "เงินฝากในพอร์ต"}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {cards.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
              <tr><td className="px-4 py-3">รวม {openCards.length} ใบ</td><td></td><td className="px-4 text-right tabular-nums">{money(cardTotal, "THB")}</td>
                <td className="px-4 text-xs text-slate-600">{cardLimit > 0 ? `วงเงินรวม ${money(cardLimit, undefined, 0)}` : ""}</td></tr>
            </tfoot>
          )}
        </table>
        <p className="px-4 py-3 text-xs text-slate-500">
          ยอดค้าง = ยอดตาม Statement ล่าสุด + รูดบัตรที่บันทึก − จ่ายบัตร หลังวันที่ของยอด (คำนวณให้) · อัปเดตยอดตาม Statement ทุกเดือน ·
          กดชื่อบัตรเพื่อดูรายการ ประวัติยอด ตั้งตัดบัญชีอัตโนมัติ และแก้ไขข้อมูลบัตร
        </p>
      </div>

      {ods.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 pt-4">
            <h2 className="font-medium text-slate-900">เงินเบิกเกินบัญชี (O/D)</h2>
            <span className="text-xs text-slate-500">ใช้ไป {money(odUsed, "THB")} จากวงเงิน {money(odLimit, "THB")} · ยอดมาจากบัญชีกระแสรายวัน (อัปเดตยอดที่หน้า Cash &amp; Bank)</span>
          </div>
          <table className="mt-2 w-full min-w-[44rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">บัญชี</th><th className="px-4 text-right">วงเงิน</th><th className="px-4 text-right">ใช้ไป</th>
                <th className="px-4 text-right">วงเงินคงเหลือ</th><th className="px-4 text-right">ดอกเบี้ย O/D</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ods.map((o) => (
                <tr key={o.asset_id} className="hover:bg-slate-50">
                  <td className="px-4 py-2"><Link href={`/financial/cash/${o.asset_id}`} className="font-medium text-slate-900 hover:underline">{o.name}</Link>
                    <div className="text-xs text-slate-500">{o.bank_name} · {o.currency}</div></td>
                  <td className="px-4 text-right tabular-nums">{money(o.limit, o.currency)}</td>
                  <td className={`px-4 text-right tabular-nums ${o.used > 0 ? "font-medium text-red-700" : "text-slate-400"}`}>{o.used > 0 ? money(o.used, o.currency) : "ยังไม่ใช้"}</td>
                  <td className={`px-4 text-right tabular-nums ${o.limit - o.used < 0 ? "text-red-700" : ""}`}>{money(o.limit - o.used, o.currency)}
                    {o.limit - o.used < 0 && <div className="text-xs">เกินวงเงิน</div>}</td>
                  <td className="px-4 text-right tabular-nums">{o.overdraft_rate != null ? `${Number(o.overdraft_rate).toFixed(2)}%` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 pb-3 pt-2 text-xs text-slate-500">ยอดติดลบของบัญชีนับเป็นหนี้สินใน Net Worth อัตโนมัติ · ดอกเบี้ย O/D ที่ธนาคารตัด บันทึกเป็นค่าใช้จ่าย &ldquo;ดอกเบี้ยจ่าย&rdquo; จากบัญชีนั้น · ตั้งวงเงินที่หน้าบัญชี → แก้ไขข้อมูล</p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex items-baseline justify-between gap-3 px-4 pt-4">
          <h2 className="font-medium text-slate-900">เงินกู้ &amp; เงินประกันการเช่า</h2>
          {canOrder && loans.length > 1 && <SortToggle active={ordering === "1"} {...orderHrefs("/liabilities", { p: sp.p })} />}
        </div>
        <table className="mt-2 w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">รายการ</th><th className="px-4 text-right">ยอดคงค้าง</th><th className="px-4">ยอด ณ</th>
              <th className="px-4">ค่างวด / ครบกำหนด</th><th className="px-4">หมายเหตุ</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">{pv.personId ? `ไม่มีเงินกู้ของ ${pv.personName}` : "ยังไม่มีเงินกู้"}</td></tr>}
            {rows.map((r) => {
              const li = loans.indexOf(r);
              return (
              <tr key={`${r.liability_source}-${r.source_id}`} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  {ordering === "1" && r.liability_source === "LOAN" && <span className="mr-2 align-middle">
                    <MoveButtons table="liabilities" id={r.source_id} paths={paths} {...neighbors(loans, li, (x) => x.source_id)} /></span>}
                  <Link href={r.liability_source === "LOAN" ? `/liabilities/${r.source_id}` : "/property"} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                  <div className="text-xs text-slate-500">
                    {SOURCE_LABEL[r.liability_source]}{r.liability_source === "LOAN" && ` · ${LIABILITY_TYPE_LABEL[r.subtype] ?? r.subtype}`}
                  </div>
                </td>
                <td className="px-4 text-right tabular-nums">{money(r.amount, r.currency)}
                  {r.pct != null && <div className="text-xs text-slate-500">{r.pct}% ของ {money(r.full_amount, r.currency)}</div>}</td>
                <td className="px-4">{thDate(r.balance_date)}</td>
                <td className="px-4 text-slate-600">
                  {r.monthly_payment ? `${money(r.monthly_payment)}/เดือน` : ""}
                  {r.payment_due_day ? ` · ทุกวันที่ ${r.payment_due_day}` : ""}
                  {r.due_date ? ` · ครบ ${thDate(r.due_date)}` : ""}
                </td>
                <td className={`px-4 text-xs ${DERIVED[r.derived_status ?? ""]?.cls ?? ""}`}>{DERIVED[r.derived_status ?? ""]?.text ?? ""}</td>
              </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
              <tr><td className="px-4 py-3">รวม</td><td className="px-4 text-right tabular-nums">{money(loanTotal + depTotal, "THB")}</td><td></td>
                <td className="px-4 text-xs text-slate-600">{monthly > 0 ? `${money(monthly)}/เดือน` : ""}</td><td></td></tr>
            </tfoot>
          )}
        </table>
        <p className="px-4 py-3 text-xs text-slate-500">
          เงินต้นที่บันทึกจ่าย (แยกเงินต้น / ดอกเบี้ย) ลดยอดให้ทันที · อัปเดตยอดตาม Statement เป็นระยะเพื่อความถูกต้อง
        </p>
      </div>
      </TabPanel>
    </div>
    </TabsProvider>
  );
}
