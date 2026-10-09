import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import {
  COST_STATUS, PERIODS_PER_YEAR, UTIL_EXPENSE_CATEGORY, UTIL_LABEL, money, scheduleText, thDate, thMonth, todayBangkok,
} from "@/lib/format";
import { RecordCostForm } from "../[id]/forms";

type Cost = { utility_id: string; property_asset_id: string; property_name: string; utility_type: string; provider: string | null;
  cost_period: string; due_date: string; expected_amount: number; paid_amount: number; gap: number; currency: string; status: string };
type Util = { id: string; utility_type: string; provider: string | null; expected_amount: number | null; currency: string;
  frequency: string | null; due_day: number | null; due_month: number | null; active: boolean;
  property_details: { asset_id: string; assets: { name: string; status: string; deleted_at: string | null } } };

const TABS: [string, string][] = [["open", "ค้างจ่าย / รอจ่าย"], ["all", "ทั้งหมด"]];

/** ค่าใช้จ่ายประจำของอสังหาฯ ทุกรายการ: ประมาณ vs จ่ายจริง + บันทึกจ่าย */
export default async function PropertyCostsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab === "all" ? "all" : "open";
  const me = await requireAppUser();
  const supabase = await createClient();
  const today = todayBangkok();
  const year = today.slice(0, 4);
  const [{ data: costRows }, { data: utilRows }, { data: banks }, { data: cardRows }, { data: persons }] = await Promise.all([
    supabase.from("v_property_cost_tracking")
      .select("utility_id,property_asset_id,property_name,utility_type,provider,cost_period,due_date,expected_amount,paid_amount,gap,currency,status")
      .order("due_date", { ascending: false }).limit(500),
    supabase.from("property_utilities")
      .select("id,utility_type,provider,expected_amount,currency,frequency,due_day,due_month,active,property_details!inner(asset_id,assets!inner(name,status,deleted_at))")
      .is("deleted_at", null).not("frequency", "is", null),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency").is("deleted_at", null).neq("status", "CLOSED"),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("created_at"),
  ]);
  const canWrite = me.role !== "VIEWER";
  const costs = (costRows as Cost[] | null) ?? [];
  const utils = ((utilRows as unknown as Util[] | null) ?? [])
    .filter((u) => u.active && !u.property_details.assets.deleted_at && u.property_details.assets.status === "ACTIVE");
  const cards = (cardRows ?? []).map((c) => ({ id: c.id as string, currency: c.currency as string,
    label: [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ") }));
  const name = (t: string, p: string | null) => [UTIL_LABEL[t] ?? t, p].filter(Boolean).join(" · ");

  const shown = tab === "open" ? costs.filter((c) => c.status !== "PAID").sort((a, b) => a.due_date.localeCompare(b.due_date)) : costs;
  const thisYear = costs.filter((c) => c.cost_period.startsWith(year));
  const sum = (rows: Cost[], f: (c: Cost) => number) => rows.reduce((m, c) => m.set(c.currency, (m.get(c.currency) ?? 0) + f(c)), new Map<string, number>());
  const estYear = utils.reduce((m, u) => m.set(u.currency, (m.get(u.currency) ?? 0) + Number(u.expected_amount ?? 0) * (PERIODS_PER_YEAR[u.frequency!] ?? 0)), new Map<string, number>());
  const paidYear = sum(thisYear, (c) => Number(c.paid_amount));
  const overdue = costs.filter((c) => c.status === "OVERDUE");
  const overdueAmt = sum(overdue, (c) => Number(c.expected_amount));
  const fmt = (m: Map<string, number>) => m.size ? [...m.entries()].map(([ccy, v]) => money(v, ccy, 0)).join(" + ") : money(0, "THB", 0);

  // ประมาณการต่อปี รายทรัพย์สิน
  const byProp = new Map<string, { name: string; items: Util[] }>();
  utils.forEach((u) => {
    const k = u.property_details.asset_id;
    const e = byProp.get(k) ?? { name: u.property_details.assets.name, items: [] };
    e.items.push(u); byProp.set(k, e);
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/property" className="text-sm text-slate-500 hover:underline">← Property</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">ค่าใช้จ่ายประจำอสังหาฯ</h1>
        <p className="text-sm text-slate-500">ค่าส่วนกลาง · ภาษีที่ดิน · ไฟ · น้ำ — ประมาณการ เทียบกับที่จ่ายจริง · ตั้งยอดประมาณได้ที่หน้าทรัพย์สินแต่ละรายการ</p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">ประมาณการทั้งปี</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{fmt(estYear)}</div>
          <div className="mt-1 text-xs text-slate-500">จากยอดประมาณ × จำนวนงวดต่อปี</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">จ่ายแล้ว ปี {Number(year) + 543}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{fmt(paidYear)}</div>
          <div className="mt-1 text-xs text-slate-500">นับเฉพาะงวดตั้งแต่ Go-live</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">เลยกำหนดยังไม่จ่าย</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${overdue.length ? "text-red-700" : ""}`}>{overdue.length} รายการ</div>
          <div className="mt-1 text-xs text-slate-500">{overdue.length ? `ประมาณ ${fmt(overdueAmt)}` : "ไม่มีค้าง ✓"}</div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-medium text-slate-900">ประมาณ vs จ่ายจริง</h2>
          {TABS.map(([k, label]) => (
            <Link key={k} href={k === "open" ? "/property/costs" : `/property/costs?tab=${k}`}
              className={`rounded-full px-3 py-1 text-xs ${tab === k ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{label}</Link>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-slate-500">{tab === "open" ? "ไม่มีรายการค้างจ่าย ✓" : "ยังไม่มีงวดค่าใช้จ่าย · เพิ่มยอดประมาณที่หน้าทรัพย์สินแต่ละรายการ"}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="py-1">ครบกำหนด</th><th>ทรัพย์สิน</th><th>รายการ</th><th className="text-right">ประมาณ</th>
                  <th className="text-right">จ่ายจริง</th><th className="pl-4">สถานะ</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((c) => (
                  <tr key={`${c.utility_id}-${c.cost_period}`} className="align-top">
                    <td className="py-1.5">{thDate(c.due_date)}<div className="text-xs text-slate-400">งวด {thMonth(c.cost_period)}</div></td>
                    <td><Link href={`/property/${c.property_asset_id}`} className="hover:underline">{c.property_name}</Link></td>
                    <td>{name(c.utility_type, c.provider)}</td>
                    <td className="text-right tabular-nums">{money(c.expected_amount)}</td>
                    <td className="text-right tabular-nums">{Number(c.paid_amount) > 0 ? money(c.paid_amount) : "-"}</td>
                    <td className={`pl-4 ${COST_STATUS[c.status]?.cls ?? ""}`}>{COST_STATUS[c.status]?.text ?? c.status}</td>
                    <td className="text-right">
                      {canWrite && c.status !== "PAID" && (
                        <RecordCostForm assetId={c.property_asset_id} utilityId={c.utility_id} period={c.cost_period} currency={c.currency}
                          label={`${name(c.utility_type, c.provider)} · ${c.property_name} (${thMonth(c.cost_period)})`}
                          category={UTIL_EXPENSE_CATEGORY[c.utility_type] ?? "บ้าน / สาธารณูปโภค"} expected={Number(c.expected_amount)}
                          banks={banks ?? []} cards={cards} persons={persons ?? []} today={today} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-slate-900">ประมาณการต่อปี รายทรัพย์สิน</h2>
        {byProp.size === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการที่ตั้งยอดประมาณ</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">ทรัพย์สิน</th><th>รายการ</th><th className="pl-4">กำหนดจ่าย</th><th className="text-right">ต่องวด</th><th className="text-right">ต่อปี</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...byProp.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "th")).flatMap(([assetId, p]) =>
                p.items.map((u, i) => (
                  <tr key={u.id}>
                    <td className="py-1.5">{i === 0 && <Link href={`/property/${assetId}`} className="hover:underline">{p.name}</Link>}</td>
                    <td>{name(u.utility_type, u.provider)}</td>
                    <td className="pl-4 text-slate-600">{scheduleText(u.frequency, u.due_day, u.due_month)}</td>
                    <td className="text-right tabular-nums">{money(u.expected_amount, u.currency)}</td>
                    <td className="text-right tabular-nums">{money(Number(u.expected_amount ?? 0) * (PERIODS_PER_YEAR[u.frequency!] ?? 0), u.currency, 0)}</td>
                  </tr>
                )))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
