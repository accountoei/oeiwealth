import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { LIABILITY_TYPE_LABEL, addDays, money, thDate, todayBangkok } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import { ActionBar } from "@/components/ActionBar";
import { MoveButtons, SortToggle, neighbors } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";
import { CardBalanceForm, NewCardForm } from "./cards/forms";

type Row = { liability_source: string; source_id: string; name: string; subtype: string; currency: string;
  amount: number | null; balance_date: string | null; due_date: string | null; monthly_payment: number | null;
  payment_due_day: number | null; status: string; derived_status: string | null };

type Card = { id: string; person_id: string; issuer: string; card_name: string | null; card_last4: string | null;
  credit_limit: number | null; currency: string; statement_day: number | null; due_day: number | null;
  outstanding_balance: number; balance_date: string | null; status: string; autopay_asset_id: string | null; autopay_mode: string | null;
  persons: { name: string } | { name: string }[] | null };

const SOURCE_LABEL: Record<string, string> = { LOAN: "เงินกู้", SECURITY_DEPOSIT: "เงินประกันการเช่า" };
const DERIVED: Record<string, { text: string; cls: string }> = {
  DEPOSIT_REFUND_OVERDUE: { text: "เลยกำหนดคืนเงินประกัน", cls: "text-red-600" },
  DUE_SOON: { text: "ใกล้ครบกำหนดคืน", cls: "text-amber-700" },
  HELD: { text: "ถือไว้", cls: "text-slate-500" },
};
const CARD_STATUS: Record<string, string> = { ACTIVE: "", SUSPENDED: "ระงับชั่วคราว", CLOSED: "ยกเลิกแล้ว" };

export default async function LiabilitiesPage({ searchParams }: { searchParams: Promise<{ p?: string; order?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder ? sp.order ?? "" : "";        // "1" = เงินกู้ · "cards" = บัตร
  const paths = ["/liabilities"];
  const [pv, { data, error }, loanOrder, { data: cardsRaw }, { data: cardBal }, { data: persons }, { data: family }, { data: banksRaw }] = await Promise.all([
    loadPersonView(sp.p, { liabilities: true }),
    supabase.from("v_liabilities_all").select("*").order("liability_source").order("name"),
    loadSortMap("liabilities"),
    supabase.from("credit_cards").select("id,person_id,issuer,card_name,card_last4,credit_limit,currency,statement_day,due_day,outstanding_balance,balance_date,status,autopay_asset_id,autopay_mode,persons(name)")
      .is("deleted_at", null).order("sort_order").order("issuer"),
    supabase.from("v_card_balances").select("card_id,current_balance"),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    supabase.from("v_bank_accounts_safe").select("asset_id,name"),
  ]);
  // มุมมองรายบุคคล: เฉพาะหนี้ที่คนนั้นมีส่วน · ยอด × สัดส่วน (เงินกู้ตามผู้รับผิดชอบ · บัตรตามเจ้าของบัตร · เงินประกันตามเจ้าของทรัพย์)
  const all = ((data as Row[] | null) ?? []).filter((r) => pv.showLiability(r.source_id))
    .map((r) => ({ ...r, full_amount: r.amount, pct: pv.liabilityPct(r.source_id),
      amount: r.amount == null ? null : Number(r.amount) * pv.liabilityShare(r.source_id) }));
  const totals = new Map<string, number>();
  all.forEach((r) => totals.set(r.currency, (totals.get(r.currency) ?? 0) + Number(r.amount ?? 0)));
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
  const canSettle = me.role === "ADMIN" || me.role === "EDITOR";
  const today = todayBangkok();
  const isSetup = family?.system_status === "SETUP";
  const goLive = family?.go_live_date ?? "";
  const minDate = isSetup ? "" : goLive;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Liabilities</h1>
          <p className="text-sm text-slate-500">หนี้สินทั้งหมด: เงินกู้ · บัตรเครดิต · เงินประกันการเช่า</p>
        </div>
        <PersonFilter persons={pv.persons} value={pv.personId} />
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      {totals.size > 0 && (
        <div className="flex flex-wrap gap-3">
          {[...totals.entries()].map(([ccy, v]) => (
            <div key={ccy} className="rounded-xl border border-slate-200 bg-white px-5 py-3">
              <div className="text-xs text-slate-500">{pv.personId ? `หนี้ส่วนของ ${pv.personName}` : "หนี้รวม"} {ccy}</div>
              <div className="text-lg font-semibold tabular-nums text-red-700">{money(v, ccy)}</div>
            </div>
          ))}
        </div>
      )}

      {canWrite && (
        <ActionBar>
          <Link href="/liabilities/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มเงินกู้</Link>
          <NewCardForm persons={persons ?? []} defaultDate={isSetup && goLive ? addDays(goLive, -1) : today} today={today}
            minDate={goLive} isSetup={isSetup} />
        </ActionBar>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex items-baseline gap-3 px-4 pt-4">
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
        </table>
        <p className="px-4 py-3 text-xs text-slate-500">
          เงินต้นที่บันทึกจ่าย (แยกเงินต้น / ดอกเบี้ย) ลดยอดให้ทันที · อัปเดตยอดตาม Statement เป็นระยะเพื่อความถูกต้อง
        </p>
      </div>

      <div id="cards" className="scroll-mt-20 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex items-baseline gap-3 px-4 pt-4">
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
                    <CardBalanceForm cardId={c.id} currency={c.currency} today={today} minDate={minDate} canSettle={canSettle} />
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {c.credit_limit ? `วงเงิน ${money(c.credit_limit)}` : "-"}
                  {c.statement_day ? <div>ตัดรอบวันที่ {c.statement_day}</div> : null}
                  {c.due_day ? <div>ชำระภายในวันที่ {c.due_day}</div> : null}
                  {c.autopay_asset_id && (
                    <div className="mt-1 text-emerald-700">
                      ตัดบัญชีอัตโนมัติ{c.autopay_mode === "MINIMUM" ? "ขั้นต่ำ" : "เต็มจำนวน"} จาก {bankName.get(c.autopay_asset_id) ?? "บัญชี"}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-3 text-xs text-slate-500">
          ยอดค้าง = ยอดตาม Statement ล่าสุด + รูดบัตรที่บันทึก − จ่ายบัตร หลังวันที่ของยอด (คำนวณให้) · อัปเดตยอดตาม Statement ทุกเดือน ·
          กดชื่อบัตรเพื่อดูรายการ ประวัติยอด ตั้งตัดบัญชีอัตโนมัติ และแก้ไขข้อมูลบัตร
        </p>
      </div>
    </div>
  );
}
