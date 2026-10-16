import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { money, thDate, todayBangkok } from "@/lib/format";
import { ActionBar } from "@/components/ActionBar";
import RowActions from "@/components/RowActions";
import DeleteEntity from "@/components/DeleteEntity";
import EntityDocuments from "@/components/docs/EntityDocuments";
import { CardAutopayForm, CardBalanceForm, CardStatusForm } from "../forms";
import SplitForm from "../../../income-expenses/SplitForm";
import { splitMoves } from "@/lib/split-moves";
import { buildHints } from "@/lib/category-hints";

type Line = { key: string; id: string; table: "expense_items" | "income_transactions" | ""; date: string; kind: string; text: string; amount: number; pending: boolean };

export default async function CardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: c }, { data: bal }, { data: hist }, { data: family }, { data: banksRaw }] = await Promise.all([
    supabase.from("credit_cards").select("*, persons(name)").eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("v_card_balances").select("current_balance").eq("card_id", id).maybeSingle(),
    supabase.from("credit_card_statements").select("id,statement_date,balance,notes")
      .eq("credit_card_id", id).is("deleted_at", null).order("statement_date", { ascending: false }),
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
  ]);
  if (!c) notFound();

  // รายการบัตร ตั้งแต่ Statement ก่อนหน้า (หรือยอดล่าสุด) ถึงวันนี้
  const statements = hist ?? [];
  const from = statements[1]?.statement_date ?? c.balance_date ?? "1900-01-01";
  const [{ data: exps }, { data: pays }, { data: reimbs }, { data: incs }] = await Promise.all([
    supabase.from("expense_items").select("id,date,description,amount,pending_split").eq("paid_from_credit_card_id", id)
      .is("deleted_at", null).gt("date", from),
    supabase.from("cash_movements").select("id,movement_date,amount,description").eq("to_credit_card_id", id).eq("movement_type", "CARD_PAYMENT")
      .is("deleted_at", null).gt("movement_date", from),
    supabase.from("expense_reimbursements").select("id,received_date,amount,notes").eq("received_to_credit_card_id", id)
      .is("deleted_at", null).gt("received_date", from),
    supabase.from("income_transactions").select("id,date,amount,tax,notes,pending_split").eq("received_to_credit_card_id", id)
      .is("deleted_at", null).gt("date", from),
  ]);
  // ก้อนรอแยก: แยกได้ที่หน้านี้ (คน / หมวด ชุดเดียวกับ Income & Expenses)
  const [{ data: persons }, { data: cats }] = await Promise.all([
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    supabase.from("ie_categories").select("name").eq("kind", "EXPENSE").eq("active", true).is("deleted_at", null).order("sort_order").order("name"),
  ]);
  const expCats = (cats ?? []).map((x) => x.name as string);
  const { data: hintRows } = await supabase.from("expense_items")
    .select("description,expense_category,paid_from_asset_id,paid_from_credit_card_id")
    .is("deleted_at", null).eq("pending_split", false).is("source_cash_movement_id", null).is("liability_id", null)
    .order("date", { ascending: false }).limit(1500);
  const expHints = buildHints(hintRows ?? [], expCats);
  const lines: Line[] = [
    ...(exps ?? []).map((e) => ({ key: `e${e.id}`, id: e.id as string, table: "expense_items" as const, date: e.date as string, kind: "รูดบัตร", text: e.description as string,
      amount: Number(e.amount), pending: !!e.pending_split })),
    ...(pays ?? []).map((m) => ({ key: `m${m.id}`, id: m.id as string, table: "" as const, date: m.movement_date as string, kind: "จ่ายบัตร", text: (m.description as string | null) ?? "",
      amount: -Number(m.amount), pending: false })),
    ...(reimbs ?? []).map((r) => ({ key: `r${r.id}`, id: r.id as string, table: "" as const, date: r.received_date as string, kind: "เงินคืน", text: (r.notes as string | null) ?? "",
      amount: -Number(r.amount), pending: false })),
    ...(incs ?? []).map((i) => ({ key: `i${i.id}`, id: i.id as string, table: "income_transactions" as const, date: i.date as string, kind: "เครดิตเข้าบัตร", text: (i.notes as string | null) ?? "",
      amount: -(Number(i.amount) - Number(i.tax ?? 0)), pending: !!i.pending_split })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const paths = [`/liabilities/cards/${id}`, "/liabilities"];
  const today = todayBangkok();
  const minDate = family?.system_status === "SETUP" ? "" : family?.go_live_date ?? "";
  const banks = (banksRaw ?? []) as { asset_id: string; name: string; currency: string }[];
  const bankName = new Map(banks.map((b) => [b.asset_id, b.name]));
  const holder = (Array.isArray(c.persons) ? c.persons[0]?.name : (c.persons as { name: string } | null)?.name) ?? "-";
  const current = bal?.current_balance != null ? Number(bal.current_balance) : Number(c.outstanding_balance);
  const latest = c.balance_date as string | null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/liabilities#cards" className="text-sm text-slate-500 hover:underline">← Liabilities</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{c.issuer} {c.card_name}</h1>
        <p className="text-sm text-slate-500">
          บัตรเครดิต{c.card_last4 && ` •••• ${c.card_last4}`} · {c.currency} · ผู้ถือ {holder}
          {c.status !== "ACTIVE" && <span className="text-amber-700"> · {c.status === "CLOSED" ? "ยกเลิกบัตรแล้ว" : "ระงับชั่วคราว"}</span>}
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">ยอดค้างปัจจุบัน</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-red-700">{money(current, c.currency)}</div>
          <div className="mt-1 text-xs text-slate-500">
            ตาม Statement {money(c.outstanding_balance)} ณ {thDate(latest)}
            {Math.abs(current - Number(c.outstanding_balance)) > 0.005 && " + รูด − จ่าย หลังจากนั้น"}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
          <div className="text-xs text-slate-500">เงื่อนไขบัตร</div>
          <ul className="mt-1 space-y-0.5">
            <li>วงเงิน {c.credit_limit ? money(c.credit_limit) : "-"}</li>
            <li>ตัดรอบวันที่ {c.statement_day ?? "-"} · ชำระภายในวันที่ {c.due_day ?? "-"}</li>
            <li>ค่าธรรมเนียมรายปี {c.annual_fee ? money(c.annual_fee) : "-"}</li>
            {c.expiry_date && <li>บัตรหมดอายุ {thDate(c.expiry_date)}</li>}
            {c.notes && <li className="text-slate-500">{c.notes}</li>}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
          <div className="text-xs text-slate-500">ตัดบัญชีอัตโนมัติ</div>
          <div className="mt-1">
            {c.autopay_asset_id
              ? <span className="text-emerald-700">{c.autopay_mode === "MINIMUM" ? "ขั้นต่ำ" : "เต็มจำนวน"} จาก {bankName.get(c.autopay_asset_id) ?? "บัญชี"}</span>
              : <span className="text-slate-500">ไม่ได้ตั้ง</span>}
            {c.autopay_asset_id && !c.due_day && <div className="text-xs text-amber-700">ยังไม่ได้ใส่วันครบชำระ</div>}
          </div>
          {canWrite && c.status !== "CLOSED" && (
            <CardAutopayForm cardId={id} banks={banks.filter((b) => b.currency === c.currency)} bank={c.autopay_asset_id} mode={c.autopay_mode} />
          )}
        </div>
      </section>

      {canWrite && c.status !== "CLOSED" && (
        <ActionBar>
          <CardBalanceForm cardId={id} currency={c.currency} today={today} minDate={minDate}
            banks={banks.filter((b) => b.currency === c.currency)} label="อัปเดตยอดตาม Statement" />
        </ActionBar>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 font-medium text-slate-900">รายการบัตร</h2>
        <p className="mb-3 text-xs text-slate-500">
          ตั้งแต่ {thDate(from === "1900-01-01" ? null : from)} · รายการหลัง Statement ล่าสุด ({thDate(latest)}) นับรวมในยอดค้างปัจจุบัน ·
          บันทึก / แก้ไขรายการที่ <Link href="/income-expenses" className="text-blue-700 hover:underline">Income &amp; Expenses</Link>
        </p>
        {lines.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการ</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">วันที่</th><th>ประเภท</th><th>รายละเอียด</th><th className="text-right">ยอดบัตร</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((r) => (
                <tr key={r.key} className={latest && r.date <= latest ? "text-slate-500" : ""}>
                  <td className="py-1.5">{thDate(r.date)}</td>
                  <td>{r.kind}</td>
                  <td>{r.text}{r.pending && <span className="ml-1 rounded bg-amber-100 px-1.5 text-xs text-amber-800">รอแยกรายละเอียด</span>}</td>
                  <td className={`text-right tabular-nums ${r.amount < 0 ? "text-emerald-700" : ""}`}>{r.amount > 0 ? "+" : ""}{money(r.amount)}</td>
                  <td className="pl-2 text-right">
                    {/* ก้อนรอแยก: กดที่แถวเพื่อแยกรายการ / ลงเป็นการจ่ายบัตรจากบัญชี */}
                    {canDelete && r.pending && r.table && (
                      <RowActions table={r.table} id={r.id} paths={paths} canDelete={false}
                        editor={<SplitForm kind={r.table === "income_transactions" ? "INCOME" : "EXPENSE"} id={r.id} amount={Math.abs(r.amount)}
                          currency={c.currency} persons={persons ?? []} categories={expCats} personDefault="ตามเจ้าของบัตร" hints={expHints}
                          label={r.table === "income_transactions" ? "แยกรายการ / ลงเป็นการจ่าย" : "แยกรายการ"}
                          moves={splitMoves({ kind: r.table === "income_transactions" ? "INCOME" : "EXPENSE", currency: c.currency, card: id },
                            { banks: banks.filter((b) => b.currency === c.currency) })} />} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 font-medium text-slate-900">ประวัติยอดตาม Statement</h2>
        <p className="mb-3 text-xs text-slate-500">
          ส่วนต่างจากยอดครั้งก่อนในตารางนี้ลงเป็นก้อน &ldquo;รอแยกรายละเอียด&rdquo; ให้อัตโนมัติ · บันทึกยอดวันที่เดิมซ้ำ → ระบบคำนวณก้อนใหม่ให้
        </p>
        {statements.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มียอด</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">วันที่</th><th className="text-right">ยอดตาม Statement</th><th className="pl-4">หมายเหตุ</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {statements.map((s) => (
                <tr key={s.id}>
                  <td className="py-1.5">{thDate(s.statement_date)}{s.statement_date === latest && <span className="ml-1 text-xs text-slate-400">(ล่าสุด)</span>}</td>
                  <td className="text-right tabular-nums">{money(s.balance)}</td>
                  <td className="pl-4 text-slate-500">{s.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {canWrite && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-1 font-medium text-slate-900">แก้ไขข้อมูลบัตร</h2>
          <p className="mb-3 text-xs text-slate-500">แก้เฉพาะข้อมูลบัตร ไม่กระทบยอดค้าง (ยอดแก้ด้วย &ldquo;อัปเดตยอดตาม Statement&rdquo;)</p>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 text-sm">สถานะ <CardStatusForm cardId={id} status={c.status} /></div>
            <RowActions table="credit_cards" id={id} paths={paths} canDelete={false} fields={[
              { name: "issuer", label: "ผู้ออกบัตร", value: c.issuer },
              { name: "card_name", label: "ชื่อบัตร", value: c.card_name },
              { name: "credit_limit", label: "วงเงิน", type: "number", value: c.credit_limit },
              { name: "statement_day", label: "ตัดรอบ", type: "number", value: c.statement_day, width: "w-16" },
              { name: "due_day", label: "ครบชำระ", type: "number", value: c.due_day, width: "w-16" },
              { name: "annual_fee", label: "ค่าธรรมเนียมปี", type: "number", value: c.annual_fee },
              { name: "expiry_date", label: "หมดอายุ", type: "date", value: c.expiry_date },
              { name: "notes", label: "หมายเหตุ", value: c.notes, width: "w-40" }]} />
          </div>
          {canDelete && <div className="mt-4 border-t border-slate-100 pt-3">
            <DeleteEntity kind="card" id={id} redirectTo="/liabilities" paths={["/liabilities"]} label="ลบบัตรนี้"
              hint="บัตรที่เลิกใช้จริงให้เปลี่ยนสถานะเป็น &quot;ยกเลิกบัตรแล้ว&quot;" />
          </div>}
        </section>
      )}
      <EntityDocuments entityType="CREDIT_CARD" entityId={id} module="FINANCIAL" role={me.role} paths={paths} />
    </div>
  );
}
