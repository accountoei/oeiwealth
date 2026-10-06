import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { addDays, money, thDate, todayBangkok } from "@/lib/format";
import { CardBalanceForm, CardStatusForm, NewCardForm } from "./forms";
import RowActions from "@/components/RowActions";
import DeleteEntity from "@/components/DeleteEntity";
import { MembershipForm, PointsForm } from "./member-forms";

type Card = { id: string; person_id: string; issuer: string; card_name: string | null; card_last4: string | null;
  credit_limit: number | null; currency: string; statement_day: number | null; due_day: number | null;
  annual_fee: number | null; expiry_date: string | null; outstanding_balance: number; balance_date: string | null;
  status: string; notes: string | null; persons: { name: string } | { name: string }[] | null };

const STATUS_CLS: Record<string, string> = { ACTIVE: "", SUSPENDED: "opacity-70", CLOSED: "opacity-50" };

export default async function CardsPage() {
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data, error }, { data: persons }, { data: family }, { data: paidAfter }, { data: members }, { data: points }] = await Promise.all([
    supabase.from("credit_cards").select("*, persons(name)").is("deleted_at", null).order("status").order("issuer"),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("created_at"),
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    supabase.from("v_liabilities_all").select("source_id").eq("liability_source", "CREDIT_CARD")
      .eq("derived_status", "PAID_AFTER_BALANCE_DATE"),
    supabase.from("memberships").select("*").is("deleted_at", null).order("status").order("program_name"),
    supabase.from("points_accounts").select("*").is("deleted_at", null).order("program_name"),
  ]);
  const cards = (data as Card[] | null) ?? [];
  const paidSet = new Set((paidAfter ?? []).map((r) => r.source_id));
  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const today = todayBangkok();
  const isSetup = family?.system_status === "SETUP";
  const goLive = family?.go_live_date ?? "";
  const openingDate = goLive ? addDays(goLive, -1) : today;
  const minDate = isSetup ? "" : goLive;
  const totals = new Map<string, number>();
  cards.filter((c) => c.status !== "CLOSED")
    .forEach((c) => totals.set(c.currency, (totals.get(c.currency) ?? 0) + Number(c.outstanding_balance)));
  const pmap = new Map((persons ?? []).map((p) => [p.id, p.name]));
  const holder = (c: Card) => (Array.isArray(c.persons) ? c.persons[0]?.name : c.persons?.name) ?? "-";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Cards &amp; Membership</h1>
        <p className="text-sm text-slate-500">
          บัตรเครดิตของสมาชิก · ยอดค้างนับเป็นหนี้ของผู้ถือบัตร (ยกเว้นบัตรที่ยกเลิกแล้ว) · สมาชิกภาพและแต้มสะสมอยู่ด้านล่าง
        </p>
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}

      {totals.size > 0 && (
        <div className="flex flex-wrap gap-3">
          {[...totals.entries()].map(([ccy, v]) => (
            <div key={ccy} className="rounded-xl border border-slate-200 bg-white px-5 py-3">
              <div className="text-xs text-slate-500">ยอดค้างบัตรรวม {ccy}</div>
              <div className="text-lg font-semibold tabular-nums text-red-700">{money(v, ccy)}</div>
            </div>
          ))}
        </div>
      )}

      {canWrite && (
        <NewCardForm persons={persons ?? []} defaultDate={isSetup ? openingDate : today} today={today}
          minDate={goLive} isSetup={isSetup} />
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">บัตร</th><th className="px-4">ผู้ถือ</th><th className="px-4 text-right">ยอดค้าง</th>
              <th className="px-4">วงเงิน / รอบบิล</th><th className="px-4">สถานะ</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cards.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">ยังไม่มีบัตรเครดิต</td></tr>}
            {cards.map((c) => (
              <tr key={c.id} className={`align-top ${STATUS_CLS[c.status] ?? ""}`}>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">{c.issuer} {c.card_name}</div>
                  <div className="text-xs text-slate-500">
                    {c.card_last4 ? `•••• ${c.card_last4}` : "ไม่ระบุเลขท้าย"} · {c.currency}
                    {c.expiry_date && ` · หมดอายุ ${thDate(c.expiry_date)}`}
                  </div>
                  {c.notes && <div className="text-xs text-slate-400">{c.notes}</div>}
                </td>
                <td className="px-4 py-3">{holder(c)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="tabular-nums">{money(c.outstanding_balance, c.currency)}</div>
                  <div className="text-xs text-slate-500">ณ {thDate(c.balance_date)}</div>
                  {paidSet.has(c.id) && <div className="text-xs text-amber-700">จ่ายบัตรแล้ว ยังไม่อัปเดตยอด</div>}
                  {canWrite && c.status !== "CLOSED" && (
                    <CardBalanceForm cardId={c.id} currency={c.currency} today={today} minDate={minDate} />
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {c.credit_limit ? `วงเงิน ${money(c.credit_limit)}` : "-"}
                  {c.statement_day ? <div>ตัดรอบวันที่ {c.statement_day}</div> : null}
                  {c.due_day ? <div>ชำระภายในวันที่ {c.due_day}</div> : null}
                  {c.annual_fee ? <div>ค่าธรรมเนียมปีละ {money(c.annual_fee)}</div> : null}
                </td>
                <td className="px-4 py-3">
                  {canWrite ? <CardStatusForm cardId={c.id} status={c.status} /> : c.status}
                  {canWrite && (
                    <div className="mt-2">
                      <RowActions table="credit_cards" id={c.id} paths={["/family/cards", "/liabilities"]} canDelete={false} fields={[
                        { name: "issuer", label: "ผู้ออกบัตร", value: c.issuer },
                        { name: "card_name", label: "ชื่อบัตร", value: c.card_name },
                        { name: "credit_limit", label: "วงเงิน", type: "number", value: c.credit_limit },
                        { name: "statement_day", label: "ตัดรอบ", type: "number", value: c.statement_day, width: "w-16" },
                        { name: "due_day", label: "ครบชำระ", type: "number", value: c.due_day, width: "w-16" },
                        { name: "annual_fee", label: "ค่าธรรมเนียมปี", type: "number", value: c.annual_fee },
                        { name: "expiry_date", label: "หมดอายุ", type: "date", value: c.expiry_date },
                        { name: "notes", label: "หมายเหตุ", value: c.notes, width: "w-40" }]} />
                    </div>
                  )}
                  {canDelete && <DeleteEntity kind="card" id={c.id} paths={["/family/cards", "/liabilities"]} label="ลบ" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        อัปเดตยอดค้างจาก Statement ทุกเดือน · การจ่ายบัตรบันทึกเป็นรายการเงินออกจากบัญชี (หน้า Income &amp; Expenses)
      </p>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">สมาชิกภาพ</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">โปรแกรม</th><th className="px-4">สมาชิก</th><th className="px-4">ระดับ / สิทธิ</th><th className="px-4">หมดอายุ</th><th></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(members ?? []).length === 0 && <tr><td colSpan={5} className="px-4 py-4 text-center text-slate-500">ยังไม่มี</td></tr>}
              {(members ?? []).map((m) => (
                <tr key={m.id} className={`align-top ${m.status !== "ACTIVE" ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5"><div className="font-medium">{m.program_name}</div>{m.member_id && <div className="text-xs text-slate-500">เลขสมาชิก {m.member_id}</div>}</td>
                  <td className="px-4">{pmap.get(m.person_id) ?? "-"}</td>
                  <td className="px-4 text-xs">{m.tier}{m.benefits && <div className="text-slate-500">{m.benefits}</div>}</td>
                  <td className={`px-4 ${m.expiry_date && m.expiry_date < today ? "text-red-600" : ""}`}>{thDate(m.expiry_date)}</td>
                  <td className="px-4 text-right">{canWrite && <RowActions table="memberships" id={m.id} paths={["/family/cards"]} canDelete={canDelete} fields={[
                    { name: "program_name", label: "โปรแกรม", value: m.program_name }, { name: "member_id", label: "เลขสมาชิก", value: m.member_id },
                    { name: "tier", label: "ระดับ", value: m.tier, width: "w-24" }, { name: "expiry_date", label: "หมดอายุ", type: "date", value: m.expiry_date },
                    { name: "status", label: "สถานะ", type: "select", value: m.status, options: [["ACTIVE", "ใช้งาน"], ["EXPIRED", "หมดอายุ"], ["CANCELLED", "ยกเลิก"]] },
                    { name: "benefits", label: "สิทธิประโยชน์", value: m.benefits, width: "w-48" }]} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canWrite && <MembershipForm persons={persons ?? []} />}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">แต้มสะสม / ไมล์</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">โปรแกรม</th><th className="px-4">สมาชิก</th><th className="px-4 text-right">คงเหลือ</th><th className="px-4">แต้มหมดอายุ</th><th></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(points ?? []).length === 0 && <tr><td colSpan={5} className="px-4 py-4 text-center text-slate-500">ยังไม่มี</td></tr>}
              {(points ?? []).map((pt) => (
                <tr key={pt.id} className="align-top">
                  <td className="px-4 py-2.5 font-medium">{pt.program_name}</td>
                  <td className="px-4">{pmap.get(pt.person_id) ?? "-"}</td>
                  <td className="px-4 text-right"><div className="tabular-nums">{Number(pt.balance).toLocaleString("th-TH")}</div><div className="text-xs text-slate-500">ณ {thDate(pt.balance_date)}</div></td>
                  <td className={`px-4 ${pt.expiry_date && pt.expiry_date <= today ? "text-red-600" : ""}`}>{thDate(pt.expiry_date)}</td>
                  <td className="px-4 text-right">{canWrite && <RowActions table="points_accounts" id={pt.id} paths={["/family/cards"]} canDelete={canDelete} fields={[
                    { name: "balance", label: "คงเหลือ", type: "number", value: pt.balance }, { name: "balance_date", label: "ณ วันที่", type: "date", value: today },
                    { name: "expiry_date", label: "หมดอายุ", type: "date", value: pt.expiry_date }]} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canWrite && <PointsForm persons={persons ?? []} today={today} links={[
          ...(members ?? []).map((m) => ({ value: `m:${m.id}`, label: `สมาชิกภาพ ${m.program_name}` })),
          ...cards.map((c) => ({ value: `c:${c.id}`, label: `บัตร ${c.issuer} ${c.card_name ?? ""}` }))]} />}
        <p className="text-xs text-slate-500">แต้ม / ไมล์ ไม่นับรวมใน Net Worth · กดแก้ไขเพื่ออัปเดตยอดตาม Statement</p>
      </section>
    </div>
  );
}
