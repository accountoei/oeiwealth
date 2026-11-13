import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { detailTitle } from "@/lib/page-title";
import { requireAppUser } from "@/lib/auth";
import { LIABILITY_TYPE_LABEL, money, thDate, todayBangkok } from "@/lib/format";
import { AddBalanceForm, EditLiabilityForm, PayLiabilityForm } from "./forms";
import { ActionBar } from "@/components/ActionBar";
import RowActions from "@/components/RowActions";
import PairEdit from "@/components/PairEdit";
import OwnershipEditor from "@/components/OwnershipEditor";
import EntityDocuments from "@/components/docs/EntityDocuments";
import EditToggle from "@/components/EditToggle";
import { debtDropIncomeFields, debtInterestFields } from "@/lib/source-edit";
import { splitMoves } from "@/lib/split-moves";
import SplitForm from "../../income-expenses/SplitForm";
import { DetailItem as Item } from "@/components/Boxes";
import { InfoTip } from "@/components/HeaderBar";
import { activeBanks } from "@/lib/pay-sources";

const SOURCE_LABEL: Record<string, string> = { OPENING: "ยอดตั้งต้น", STATEMENT: "Statement", USER: "ผู้ใช้" };
const STATUS_LABEL: Record<string, string> = { ACTIVE: "ยังผ่อนอยู่", CLOSED: "ปิดหนี้แล้ว", WRITTEN_OFF: "ตัดหนี้สูญ / ยกหนี้" };

// ข้อมูลหลักของหน้า: ใช้ทั้งชื่อแท็บเบราว์เซอร์และในหน้า (cache → โหลดครั้งเดียวต่อการเปิดหน้า)
const loadLiability = cache(async (id: string) =>
  (await createClient()).from("liabilities").select("*, linked:assets!liabilities_linked_asset_id_fkey(name)")
    .eq("id", id).is("deleted_at", null).maybeSingle());

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return detailTitle(() => loadLiability(id).then((r) => r.data?.name), "Liabilities");
}

export default async function LiabilityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: l }, { data: owners }, { data: vals }, { data: family }, { data: persons }, { data: banksRaw }, { data: pays }, { data: ints }, { data: biz }] = await Promise.all([
    loadLiability(id),
    supabase.from("liability_ownerships").select("id,person_id,responsibility_percent,persons(name)")
      .eq("liability_id", id).is("deleted_at", null),
    supabase.from("liability_valuations").select("id,valuation_date,balance,source,notes")
      .eq("liability_id", id).is("deleted_at", null).order("valuation_date", { ascending: false }),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    activeBanks(supabase),
    supabase.from("cash_movements").select("id,movement_date,amount,from_asset_id,reduces_liability,description,notes,movement_group_id,is_derived")
      .eq("to_liability_id", id).is("deleted_at", null).order("movement_date", { ascending: false }),
    supabase.from("expense_items").select("id,date,amount,paid_from_asset_id,notes,pending_split,currency")
      .eq("liability_id", id).is("deleted_at", null).order("date", { ascending: false }),
    supabase.from("private_business_details").select("asset_id,company_name").is("deleted_at", null).order("company_name"),
  ]);
  // ยอดหนี้ลดเกินที่คำนวณ → รายได้ก้อนรอแยก / รายการที่แยกแล้ว (แก้ / แยกที่ Income & Expenses)
  const [{ data: drops }, { data: cats }] = await Promise.all([
    supabase.from("income_transactions").select("id,date,amount,tax,notes,pending_split,currency")
      .eq("received_to_liability_id", id).is("deleted_at", null).order("date", { ascending: false }),
    supabase.from("ie_categories").select("name").eq("kind", "EXPENSE").eq("active", true).is("deleted_at", null).order("sort_order").order("name"),
  ]);
  const expCats = (cats ?? []).map((c) => c.name as string);
  if (!l) notFound();

  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const paths = [`/liabilities/${id}`, "/liabilities"];
  const ownerRows = (owners ?? []).map((o) => ({
    id: o.id, person_id: o.person_id as string, pct: Number(o.responsibility_percent),
    name: (Array.isArray(o.persons) ? o.persons[0]?.name : (o.persons as { name: string } | null)?.name) ?? "-",
  }));
  const ownerTotal = ownerRows.reduce((s, o) => s + o.pct, 0);
  const linked = (Array.isArray(l.linked) ? l.linked[0] : l.linked) as { name: string } | null;
  const banks = ((banksRaw ?? []) as { asset_id: string; name: string; currency: string }[]);
  const bankName = new Map(banks.map((b) => [b.asset_id, b.name]));
  // ประวัติการจ่าย: เงินต้น (ลดยอดหนี้) · ดอกเบี้ย (ค่าใช้จ่าย) · จ่ายรวมแบบเดิม (ไม่ลดยอดหนี้)
  // จ่ายครั้งเดียวกัน (เงินต้น + ดอกเบี้ย) → ยกเลิกทั้งก้อนได้
  const groups = [...new Set((pays ?? []).map((m) => m.movement_group_id as string | null).filter((g): g is string => !!g))];
  const { data: grpInt } = groups.length
    ? await supabase.from("cash_movements").select("movement_group_id,source_entity_id").in("movement_group_id", groups)
        .eq("source_entity_type", "EXPENSE").is("deleted_at", null)
    : { data: [] as { movement_group_id: string; source_entity_id: string }[] };
  // จ่ายครั้งเดียวกัน (เงินต้น + ดอกเบี้ย) → แถวเดียว กดที่แถวแก้ทั้งคู่ในหน้าต่างเดียว · ลบทั้งก้อนข้างปุ่มบันทึก (เหมือนแท็บบันทึกจ่าย / Loans · ตกลง 10 พ.ย. 2026)
  const intById = new Map((ints ?? []).filter((e) => !e.pending_split).map((e) => [e.id as string, e]));
  const pairInt = new Map((grpInt ?? []).flatMap((g) => {
    const e = intById.get(g.source_entity_id as string);
    return e ? [[g.movement_group_id as string, e] as const] : [];
  }));
  const pairOf = (m: { is_derived?: boolean | null; movement_group_id: string | null }) => (!m.is_derived && m.movement_group_id ? pairInt.get(m.movement_group_id) : undefined);
  const pairedInt = new Set((pays ?? []).flatMap((m) => { const e = pairOf(m); return e ? [e.id as string] : []; }));
  type Pair = { group: string; principal: { id: string; date: string; amount: number }; interest: { id: string; date: string; amount: number } };
  const payRows = [
    ...(pays ?? []).map((m) => {
      const e = pairOf(m);
      const pair: Pair | null = e ? { group: m.movement_group_id as string, principal: { id: m.id, date: m.movement_date as string, amount: Number(m.amount) },
        interest: { id: e.id as string, date: e.date as string, amount: Number(e.amount) } } : null;
      return { key: `m${m.id}`, table: "cash_movements", id: m.id, date: m.movement_date as string, amount: Number(m.amount) + (e ? Number(e.amount) : 0),
        kind: e ? "เงินต้น + ดอกเบี้ย" : m.reduces_liability ? "เงินต้น" : "จ่ายรวม (ไม่ได้แยก)", pair, bank: m.from_asset_id as string | null,
        notes: e ? [`เงินต้น ${money(m.amount)} · ดอกเบี้ย ${money(e.amount)}`, m.notes].filter(Boolean).join(" · ") : m.notes as string | null,
        dateField: "movement_date", pending: false };
    }),
    ...(ints ?? []).filter((e) => !pairedInt.has(e.id as string)).map((e) => ({ key: `e${e.id}`, table: "expense_items", id: e.id, date: e.date as string, amount: Number(e.amount),
      kind: e.pending_split ? "หนี้เพิ่ม (รอแยกรายละเอียด)" : e.paid_from_asset_id ? "ดอกเบี้ย" : "ดอกเบี้ย / ค่าธรรมเนียม (ทบเข้าหนี้)",
      pair: null as Pair | null, bank: e.paid_from_asset_id as string | null, notes: e.notes as string | null, dateField: "date",
      pending: !!e.pending_split })),
    ...(drops ?? []).map((i) => ({ key: `i${i.id}`, table: "income_transactions", id: i.id, date: i.date as string, amount: Number(i.amount) - Number(i.tax ?? 0),
      kind: i.pending_split ? "หนี้ลด (รอแยกรายละเอียด)" : "หนี้ลด (รายได้)", pair: null as Pair | null, bank: null as string | null,
      notes: i.notes as string | null, dateField: "date", pending: !!i.pending_split })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind, "th"));
  const today = todayBangkok();
  const minDate = family?.go_live_date ?? "";
  const paid = l.original_amount && l.outstanding_amount != null ? Number(l.original_amount) - Number(l.outstanding_amount) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/liabilities" className="text-sm text-slate-500 hover:underline">← Liabilities</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{l.name}</h1>
            <p className="text-sm text-slate-500">
              {LIABILITY_TYPE_LABEL[l.liability_type] ?? l.liability_type}{l.lender && ` · ${l.lender}`} · {l.currency}
              {" · "}<span className={l.status === "ACTIVE" ? "" : "text-slate-400"}>{STATUS_LABEL[l.status] ?? l.status}</span>
            </p>
          </div>
          {canWrite && l.status === "ACTIVE" && (
            <ActionBar>
              <PayLiabilityForm liabilityId={id} currency={l.currency} banks={banks.filter((b) => b.currency === l.currency)}
                monthlyPayment={l.monthly_payment != null ? Number(l.monthly_payment) : null} today={today} minDate={minDate} />
            </ActionBar>
          )}
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* ซ้าย: ยอดคงค้าง */}
        <div className="flex flex-col gap-4 [&>:last-child]:flex-1">
          <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
            <div className="text-xs text-slate-500">ยอดคงค้างล่าสุด</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-red-700">{money(l.outstanding_amount, l.currency)}</div>
            <div className="mt-1 text-xs text-slate-500">ณ {thDate(l.balance_date)}
              {(vals ?? [])[0] && (vals ?? [])[0].valuation_date !== l.balance_date && ` (ยอด ${thDate((vals ?? [])[0].valuation_date)} หักเงินต้นที่จ่ายหลังจากนั้น)`}</div>
            {paid != null && paid > 0 && (
              <div className="mt-1 text-xs text-slate-500">จากวงเงิน {money(l.original_amount)} · ชำระแล้ว {money(paid)}
                {Number(l.original_amount) > 0 && <> (<span className="font-semibold">{((paid * 100) / Number(l.original_amount)).toFixed(1)}%</span>)</>}</div>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <EditToggle title="รายละเอียด" canEdit={canWrite}
            view={
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Item label="ประเภท">{LIABILITY_TYPE_LABEL[l.liability_type] ?? l.liability_type}</Item>
                <Item label="ผู้ให้กู้">{l.lender || "-"}
                  {l.lender_business_id && <span className="block text-xs text-slate-500">กิจการของครอบครัว · <Link href={`/financial/business/${l.lender_business_id}`} className="text-blue-700 hover:underline">ดูกิจการ</Link> · ฝั่งกิจการไม่ตั้งลูกหนี้แยก (อยู่ในมูลค่ากิจการแล้ว)</span>}</Item>
                <Item label="สถานะ">{STATUS_LABEL[l.status] ?? l.status}</Item>
                <Item label="อัตราดอกเบี้ย">{l.interest_rate != null ? `${Number(l.interest_rate)}% ต่อปี` : "-"}</Item>
                <Item label="ค่างวด" num>{l.monthly_payment ? `${money(l.monthly_payment)}/เดือน` : "-"}{l.payment_due_day ? <span className="block text-xs text-slate-500">ทุกวันที่ {l.payment_due_day}</span> : null}</Item>
                <Item label="ระยะสัญญา">{thDate(l.start_date)} – {thDate(l.due_date)}</Item>
                <Item label="วงเงินกู้" num>{money(l.original_amount, l.currency)}</Item>
                {linked && <Item label="ผูกกับทรัพย์สิน">{linked.name}</Item>}
                <Item label="ผู้รับผิดชอบหนี้">
                  {ownerRows.length === 0 ? "-" : ownerRows.map((o) => <div key={o.id}>{o.name} · {o.pct}%</div>)}
                  {ownerTotal < 99.99999 && <div className="text-xs text-amber-700">ยังไม่ระบุผู้รับผิดชอบ {Math.round((100 - ownerTotal) * 10000) / 10000}%</div>}
                </Item>
                {l.notes && <Item label="หมายเหตุ" wide>{l.notes}</Item>}
              </dl>
            }
            edit={
              <div className="space-y-5">
                <p className="text-xs text-slate-500">แก้เฉพาะข้อมูลสัญญา ไม่กระทบยอดคงค้าง (อัปเดตยอดที่กล่อง &ldquo;ยอดคงค้าง&rdquo; ด้านล่าง)</p>
                <EditLiabilityForm l={l} businesses={(biz ?? []).map((b) => ({ id: b.asset_id, name: b.company_name }))} remove={canDelete ? { kind: "liability", id, redirectTo: "/liabilities", paths: ["/liabilities"], label: "ลบหนี้รายการนี้",
                  hint: "ปิดหนี้จริงให้เปลี่ยนสถานะเป็น \"ปิดหนี้แล้ว\"" } : undefined} />
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="mb-2 text-sm font-medium text-slate-800">ผู้รับผิดชอบหนี้</h3>
                  <OwnershipEditor kind="liability" id={id} persons={persons ?? []} paths={paths} today={today}
                    current={ownerRows.map((o) => ({ person_id: o.person_id, percent: o.pct }))} />
                </div>
              </div>
            } />
        </div>
        {/* ขวา: เอกสาร (เรียง มูลค่า | รายละเอียด | เอกสาร · ตกลง 5 พ.ย. 2026) */}
        <div className="flex flex-col md:col-span-2 lg:col-span-1">
          <EntityDocuments category="LIABILITY" entityType="LIABILITY" entityId={id} module="FINANCIAL" role={me.role} paths={paths} fill />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-slate-900">ประวัติการจ่าย <InfoTip label="คำอธิบาย">เงินต้นลดยอดหนี้ให้ทันที · ดอกเบี้ยอยู่ในค่าใช้จ่าย หมวด &ldquo;ดอกเบี้ยจ่าย&rdquo; · หนี้เพิ่ม / หนี้ลด = ยอดตาม Statement ต่างจากที่คำนวณ · กดที่แถวเพื่อแยกรายการ / ลงเป็นการจ่าย / แก้ / ลบ</InfoTip></h2>
        {payRows.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีการจ่าย</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">วันที่</th><th>ประเภท</th><th className="text-right">จำนวน</th><th className="pl-4">จากบัญชี</th><th className="pl-4">หมายเหตุ</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payRows.map((r) => (
                <tr key={r.key}>
                  <td className="py-1.5">{thDate(r.date)}</td>
                  <td className={r.pending || r.kind.startsWith("ดอกเบี้ย") ? "text-amber-700" : r.kind.startsWith("หนี้ลด") ? "text-emerald-700" : ""}>{r.kind}</td>
                  <td className="text-right tabular-nums">{money(r.amount)}</td>
                  <td className="pl-4 text-slate-600">{r.bank ? bankName.get(r.bank) ?? "บัญชี" : "-"}</td>
                  <td className="pl-4 text-slate-500">{r.notes}</td>
                  <td className="pl-2 text-right">
                    {canWrite && r.pending ? (
                      <RowActions table={r.table} id={r.id} paths={[...paths, "/income-expenses"]} canDelete={false}
                        editor={canDelete ? <SplitForm kind={r.table === "income_transactions" ? "INCOME" : "EXPENSE"} id={r.id} amount={r.amount}
                          currency={l.currency} persons={persons ?? []} categories={expCats} personDefault="ตามผู้รับผิดชอบหนี้"
                          label={r.table === "income_transactions" ? "แยกรายการ / ลงเป็นการจ่าย" : "แยกรายการ"}
                          moves={splitMoves({ kind: r.table === "income_transactions" ? "INCOME" : "EXPENSE", currency: l.currency, liab: id },
                            { banks: banks.filter((b) => b.currency === l.currency) })} />
                          : <span className="text-xs text-slate-500">ADMIN / EDITOR แยกรายการได้</span>} />
                    ) : canWrite && r.pair ? (
                      <PairEdit group={r.pair.group} paths={[...paths, "/income-expenses"]} canDelete={canDelete} direction="OUT" currency={l.currency}
                        principal={r.pair.principal} interest={{ table: "expense_items", ...r.pair.interest }}
                        confirmText={`ลบการจ่ายวันที่ ${thDate(r.date)}?\nเงินต้น ${money(r.pair.principal.amount)} + ดอกเบี้ย ${money(r.pair.interest.amount)} จะถูกลบพร้อมกัน\n(ถ้าผิดแค่ยอด ให้แก้ยอดแล้วกดบันทึกแทน)`} />
                    ) : canWrite && <RowActions table={r.table} id={r.id} paths={[...paths, "/income-expenses"]} canDelete={canDelete}
                      fields={r.table === "income_transactions" ? debtDropIncomeFields(r)
                        : r.table === "expense_items" ? debtInterestFields(r)
                        : [{ name: r.dateField, label: "วันที่", type: "date", value: r.date },
                           { name: "amount", label: "จำนวน", type: "number", value: r.amount }]} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <div>
          <h2 className="font-medium text-slate-900">ยอดคงค้าง <InfoTip label="คำอธิบาย">กรอกยอดเงินต้นคงเหลือจาก Statement / แอปธนาคาร · ยอดนี้ใช้แทนยอดที่ระบบหักจากเงินต้นที่จ่ายก่อนวันที่ของยอด</InfoTip></h2>
        </div>
        {canWrite && l.status === "ACTIVE" && <AddBalanceForm liabilityId={id} currency={l.currency} today={today} minDate={minDate} banks={banks.filter((b) => b.currency === l.currency)} />}
        {(vals ?? []).length === 0 ? <p className="text-sm text-slate-500">ยังไม่มียอด</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">วันที่</th><th className="text-right">ยอดคงค้าง</th><th className="pl-4">ที่มา</th><th className="pl-4">หมายเหตุ</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(vals ?? []).map((v) => (
                <tr key={v.id}>
                  <td className="py-1.5">{thDate(v.valuation_date)}</td>
                  <td className="text-right tabular-nums">{money(v.balance)}</td>
                  <td className="pl-4">{SOURCE_LABEL[v.source] ?? v.source}</td>
                  <td className="pl-4 text-slate-500">{v.notes}</td>
                  <td className="pl-2 text-right">
                    {canWrite && <RowActions table="liability_valuations" id={v.id} paths={paths} canDelete={canDelete && (vals ?? []).length > 1}
                      fields={[{ name: "valuation_date", label: "วันที่", type: "date", value: v.valuation_date },
                        { name: "balance", label: "ยอด", type: "number", value: v.balance },
                        { name: "notes", label: "หมายเหตุ", value: v.notes, width: "w-40" }]} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

    </div>
  );
}
