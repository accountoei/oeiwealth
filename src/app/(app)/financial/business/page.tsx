import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ADD_BTN, addDays, money, monthOptions, monthRange, qty, thDate, thMonth, todayBangkok } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import MonthPicker from "@/components/MonthPicker";
import { HeaderFilters, PageInfo } from "@/components/HeaderBar";
import { TabActions } from "@/components/TabActions";
import { MoveButtons, SortToggle, bySort, neighbors } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";
import BusinessBadge from "./badge";
import { TabNav, TabPanel, TabsProvider } from "../../income-expenses/tabs";
import BusinessBatch, { type BizBank, type BizRow } from "./BusinessBatch";
import { recEdit, recLabel } from "@/lib/recorded-edit";
import { businessDividendFields } from "@/lib/source-edit";

const TABS: [string, string][] = [["overview", "ภาพรวม"], ["record", "บันทึกรับเงินปันผล/อัพเดตมูลค่า"]];

type Row = { id: string; asset_id: string; company_name: string; logo_data: string | null; business_type: string | null; company_ownership_percent: number | null;
  total_shares: number | null; shares_owned: number | null; par_value: number | null; investment_cost: number | null;
  status: string; assets: { name: string; currency: string; current_value: number | null; current_value_date: string | null } };
type Own = { asset_id: string; person_id: string; ownership_percent: number; shares: number | null; cost_per_share: number | null; start_date: string; end_date: string | null };

const COLORS = ["#2563eb", "#7c3aed", "#f43f5e", "#f59e0b", "#8b5cf6", "#10b981", "#0ea5e9", "#ec4899", "#14b8a6", "#64748b"];

export default async function BusinessPage({ searchParams }: { searchParams: Promise<{ p?: string; order?: string; tab?: string; m?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const pv = await loadPersonView(sp.p);
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder && sp.order === "1";
  const paths = ["/financial/business"];
  const sortMap = await loadSortMap("assets");
  const today = todayBangkok();
  // เดือนที่เลือก (แถบบน · ตกลง 28 ต.ค. 2026): ปันผลตั้งแต่ต้นปีของปีนั้นถึงสิ้นเดือน · แท็บบันทึก = รายการรับแล้วของเดือน + วันที่ตั้งต้นสิ้นเดือน
  const ym = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : today.slice(0, 7);
  const { start: mStart, end: mEnd } = monthRange(ym);
  const defaultDate = mEnd < today ? mEnd : today;
  const yearStart = `${ym.slice(0, 4)}-01-01`;
  const divEnd = defaultDate;
  const { data, error } = await supabase.from("private_business_details")
    .select("id,asset_id,company_name,logo_data,business_type,company_ownership_percent,total_shares,shares_owned,par_value,investment_cost,status,assets!inner(name,currency,current_value,current_value_date,deleted_at)")
    .is("deleted_at", null).is("assets.deleted_at", null).order("created_at");
  const all = (data as unknown as Row[] | null) ?? [];
  const ids = all.map((r) => r.asset_id);
  const none = Promise.resolve({ data: [] as never[] });
  const canWrite = me.role !== "VIEWER";
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as string) : "overview";
  const [{ data: owners }, { data: divs }, { data: divShares }, { data: bankAccs }, { data: bankOwners }, { data: family }, { data: people }] = await Promise.all([
    ids.length ? supabase.from("asset_ownerships").select("asset_id,person_id,ownership_percent,shares,cost_per_share,start_date,end_date").in("asset_id", ids).is("deleted_at", null) : none,
    ids.length ? supabase.from("income_transactions").select("id,asset_id,base_amount,person_id,date,amount,tax,notes,currency").in("asset_id", ids).eq("income_type", "BUSINESS_DIVIDEND")
      .gte("date", yearStart).lte("date", divEnd).is("deleted_at", null) : none,
    pv.personId ? supabase.from("v_income_by_person").select("income_id,base_amount_share").eq("person_id", pv.personId).eq("income_type", "BUSINESS_DIVIDEND").gte("date", yearStart).lte("date", divEnd) : none,
    canWrite ? supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name") : none,
    canWrite ? supabase.from("v_asset_ownerships_active").select("asset_id,person_id,end_date") : none,
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null),
  ]);
  const rowsBase = bySort(all.filter((r) => pv.showAsset(r.asset_id)), (r) => r.asset_id, sortMap);
  const color = new Map(all.map((r, i) => [r.asset_id, COLORS[i % COLORS.length]]));
  const old = addDays(today, -365);
  // % ของบริษัท: ทั้งครอบครัว = ที่บันทึก · รายคน = หุ้นของคน ÷ หุ้นทั้งหมด (หรือ สัดส่วนในครอบครัว × % ของครอบครัว)
  const famPct = (r: Row): number | null => (r.total_shares && r.shares_owned ? (Number(r.shares_owned) * 100) / Number(r.total_shares)
    : r.company_ownership_percent != null ? Number(r.company_ownership_percent) : null);
  const companyPct = (r: Row): number | null => {
    const fam = famPct(r);
    if (!pv.personId) return fam;
    const sh = pv.assetShares(r.asset_id);
    if (sh != null && r.total_shares) return (sh * 100) / Number(r.total_shares);
    return fam == null ? null : (fam * pv.assetShare(r.asset_id));
  };
  const fmtPct = (v: number | null) => (v == null ? "-" : `${v.toLocaleString("th-TH", { maximumFractionDigits: 2 })}%`);
  const famValue = (r: Row) => (r.assets.current_value == null ? null : Number(r.assets.current_value));
  const myValue = (r: Row) => { const v = famValue(r); return v == null ? null : v * pv.assetShare(r.asset_id); };
  // ทุนจดทะเบียน = หุ้นทั้งหมดของบริษัท × มูลค่าหุ้นที่ตราไว้ (par) — ตัวเลขของทั้งบริษัท ไม่ขึ้นกับผู้ถือ
  const regCapital = (r: Row) => (r.total_shares != null && r.par_value != null ? Number(r.total_shares) * Number(r.par_value) : null);
  // ราคาทุน: ทั้งครอบครัว = เงินลงทุนที่บันทึก · รายคน = หุ้นของคน × ต้นทุนต่อหุ้นของคน (ไม่มี = ต้นทุนเฉลี่ย)
  const nowOwn = ((owners ?? []) as Own[]).filter((o) => o.start_date <= today && (!o.end_date || o.end_date >= today));
  const costOf = (r: Row): number | null => {
    if (r.investment_cost == null && !pv.personId) return null;
    const famCost = r.investment_cost == null ? null : Number(r.investment_cost);
    if (!pv.personId) return famCost;
    const o = nowOwn.find((x) => x.asset_id === r.asset_id && x.person_id === pv.personId);
    const sh = o?.shares != null ? Number(o.shares) : null;
    const avg = famCost != null && r.shares_owned ? famCost / Number(r.shares_owned) : null;
    if (sh != null && (o?.cost_per_share != null || avg != null)) return sh * Number(o?.cost_per_share ?? avg);
    return famCost == null ? null : famCost * pv.assetShare(r.asset_id);
  };
  const vsCost = (r: Row): number | null => { const v = myValue(r), c = costOf(r); return v == null || !c ? null : ((v - c) * 100) / c; };
  const divShare = new Map(((divShares ?? []) as { income_id: string; base_amount_share: number }[]).map((x) => [x.income_id, Number(x.base_amount_share)]));
  const divOf = new Map<string, number>();
  ((divs ?? []) as { id: string; asset_id: string; base_amount: number | null }[]).forEach((x) => {
    const v = pv.personId ? divShare.get(x.id) ?? 0 : Number(x.base_amount ?? 0);
    divOf.set(x.asset_id, (divOf.get(x.asset_id) ?? 0) + v);
  });

  const rows = rowsBase;
  const th = (label: string, right = true) => <th className={`whitespace-nowrap px-3 py-2 ${right ? "text-right" : ""}`}>{label}</th>;

  // กล่องสรุป: สัดส่วนตามกิจการ · มูลค่าตามสมาชิก (ถือ ณ วันนี้)
  const active = rows.filter((r) => r.status === "ACTIVE" && (myValue(r) ?? 0) > 0);
  const totalFam = active.reduce((t, r) => t + (myValue(r) ?? 0), 0);
  const latestDate = active.map((r) => r.assets.current_value_date ?? "").sort().at(-1) ?? null;
  // มูลค่าตามสมาชิก: ทั้งครอบครัวเสมอ (ไม่เปลี่ยนตามสมาชิกที่เลือก)
  const byPerson = new Map<string, number>();
  const cur = nowOwn;
  const famActive = all.filter((r) => r.status === "ACTIVE" && (famValue(r) ?? 0) > 0);
  const totalAll = famActive.reduce((t, r) => t + (famValue(r) ?? 0), 0);
  const latestAll = famActive.map((r) => r.assets.current_value_date ?? "").sort().at(-1) ?? null;
  famActive.forEach((r) => {
    const os = cur.filter((o) => o.asset_id === r.asset_id);
    const bySh = os.length > 0 && os.every((o) => o.shares != null);
    const tot = os.reduce((t, o) => t + Number(bySh ? o.shares : o.ownership_percent), 0);
    os.forEach((o) => {
      const pct = bySh ? (tot > 0 ? Number(o.shares) / tot : 0) : Number(o.ownership_percent) / 100;
      byPerson.set(o.person_id, (byPerson.get(o.person_id) ?? 0) + (famValue(r) ?? 0) * pct);
    });
  });
  const personName = new Map(pv.persons.map((x) => [x.id, x.name]));
  const personRows = [...byPerson.entries()].sort((a, b) => b[1] - a[1]);
  const totals = {
    reg: rows.reduce((t, r) => t + (regCapital(r) ?? 0), 0),
    cost: rows.reduce((t, r) => t + (costOf(r) ?? 0), 0),
    val: rows.reduce((t, r) => t + (myValue(r) ?? 0), 0),
    div: rows.reduce((t, r) => t + (divOf.get(r.asset_id) ?? 0), 0),
  };
  const who = pv.personId ? pv.personName : "ครอบครัว";

  // ---------------------------------------------------------------- แท็บ "บันทึกรับเงินปันผล/อัพเดตมูลค่า" (กิจการที่ดำเนินการอยู่ · ผู้ถือหุ้น ณ วันนี้)
  type DivRow = { id: string; asset_id: string; person_id: string | null; date: string; amount: number; tax: number | null; notes: string | null; currency: string };
  const nameOf = new Map(((people ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
  const batchRows: BizRow[] = rows.filter((r) => r.status === "ACTIVE").map((r) => {
    const os = nowOwn.filter((o) => o.asset_id === r.asset_id);
    const bySh = os.length > 0 && os.every((o) => o.shares != null);
    const tot = os.reduce((t, o) => t + Number(bySh ? o.shares : o.ownership_percent), 0);
    return { id: r.asset_id, name: r.assets.name, currency: r.assets.currency,
      value: r.assets.current_value == null ? null : Number(r.assets.current_value), valueDate: r.assets.current_value_date,
      holders: os.map((o) => ({ personId: o.person_id, name: nameOf.get(o.person_id) ?? "สมาชิก", shares: o.shares == null ? null : Number(o.shares),
        pct: bySh ? (tot > 0 ? (Number(o.shares) * 100) / tot : 0) : Number(o.ownership_percent),
        // ปันผลที่รับแล้วในเดือนที่เลือก (ทีละครั้ง) → กดเพื่อแก้ / ลบ (ฟอร์มเดียวกับประวัติในหน้ากิจการ · ตกลง 28 ต.ค. 2026)
        edits: ((divs ?? []) as DivRow[]).filter((d) => d.asset_id === r.asset_id && d.person_id === o.person_id && d.date >= mStart).sort((a, b) => a.date.localeCompare(b.date))
          .map((d) => ({ id: d.id, node: recEdit({ canWrite, canDelete: me.role === "ADMIN" || me.role === "EDITOR", table: "income_transactions", id: d.id,
            label: recLabel("รับแล้ว", d.date, Number(d.amount) - Number(d.tax ?? 0), d.currency),
            paths: ["/financial/business", `/financial/business/${r.asset_id}`, "/income-expenses"], fields: businessDividendFields(d) }) })) })) };
  });
  const bizBanks: BizBank[] = ((bankAccs ?? []) as { asset_id: string; name: string; currency: string }[]).map((b) => ({
    id: b.asset_id, name: b.name, currency: b.currency,
    owners: ((bankOwners ?? []) as { asset_id: string; person_id: string; end_date: string | null }[]).filter((o) => o.asset_id === b.asset_id && !o.end_date).map((o) => o.person_id),
  }));
  const minDate = family?.system_status === "SETUP" ? "" : family?.go_live_date ?? "";
  const months = monthOptions(family?.go_live_date, today, 0, ym);

  return (
    <TabsProvider initial={tab}>
    <div className="space-y-6">
      <PageInfo>ธุรกิจของครอบครัว / หุ้นนอกตลาด · ปันผลเป็นรายได้ · เงินลงทุนเพิ่มไม่ใช่ค่าใช้จ่าย</PageInfo>
      <HeaderFilters><PersonFilter persons={pv.persons} value={pv.personId} /><MonthPicker months={months} value={ym} /></HeaderFilters>
      {me.role !== "VIEWER" && <TabActions><Link href="/financial/business/new" className={ADD_BTN}>+ เพิ่มกิจการ</Link></TabActions>}
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      <TabNav tabs={TABS} />

      <TabPanel id="overview">
      {totalFam > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-medium text-slate-900">สัดส่วนมูลค่าธุรกิจของ{who}</h2>
            <p className="mb-3 text-xs text-slate-500">รวม {money(totalFam, "THB")}{latestDate && ` ณ ${thDate(latestDate)}`}</p>
            <ShareTable label="กิจการ" rows={[...active].sort((a, b) => (myValue(b) ?? 0) - (myValue(a) ?? 0))
              .map((r) => ({ key: r.asset_id, name: r.assets.name, value: myValue(r) ?? 0, color: color.get(r.asset_id) ?? COLORS[0] }))} total={totalFam} />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-medium text-slate-900">มูลค่าตามสมาชิกครอบครัว</h2>
            <p className="mb-3 text-xs text-slate-500">รวม {money(totalAll, "THB")}{latestAll && ` ณ ${thDate(latestAll)}`}</p>
            <ShareTable label="สมาชิกครอบครัว" rows={personRows.map(([pid, v], i) => ({ key: pid, name: personName.get(pid) ?? "สมาชิก", value: v, color: COLORS[i % COLORS.length] }))} total={totalAll} />
          </div>
        </section>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex items-baseline justify-between gap-3 px-4 pt-4">
          <h2 className="font-medium text-slate-900">กิจการทั้งหมด</h2>
          {canOrder && rows.length > 1 && <SortToggle active={ordering} {...orderHrefs("/financial/business", { p: sp.p })} />}
        </div>
        <table className="mt-2 w-full min-w-[52rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              {th("กิจการ", false)}{th("ทุนจดทะเบียน (THB)")}{th("% ที่ถือ")}
              {th("ราคาทุน (THB)")}{th("มูลค่าปัจจุบัน (THB)")}{th("เทียบทุน")}{th(ym === today.slice(0, 7) ? "ปันผลปีนี้ (THB)" : `ปันผล ม.ค.–${thMonth(mStart)} (THB)`)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">{pv.personId ? `ไม่มีกิจการของ ${pv.personName}` : "ยังไม่มีรายการ"}</td></tr>}
            {rows.map((r, i) => {
              const stale = !r.assets.current_value_date || r.assets.current_value_date < old;
              const dv = divOf.get(r.asset_id) ?? 0;
              const vc = vsCost(r);
              const sh = pv.personId ? pv.assetShares(r.asset_id) : r.shares_owned != null ? Number(r.shares_owned) : null;
              // ราคาทุนต่อหุ้น = ราคาทุน ÷ หุ้นที่ถือ (ไม่มีจำนวนหุ้น = ใช้ par)
              const cst = costOf(r);
              const costPerShare = cst != null && sh ? cst / sh : r.par_value != null ? Number(r.par_value) : null;
              const num = "px-3 py-3 align-top text-right tabular-nums";
              return (
                <tr key={r.id} className={r.status !== "ACTIVE" ? "opacity-50" : ""}>
                  <td className="px-3 py-3 align-top">
                    <div className="flex items-start gap-3">
                      {ordering && <MoveButtons table="assets" id={r.asset_id} paths={paths} {...neighbors(rows, i, (x) => x.asset_id)} />}
                      <BusinessBadge logo={r.logo_data} name={r.assets.name} color={color.get(r.asset_id) ?? COLORS[0]} />
                      <div className="min-w-0">
                        <Link href={`/financial/business/${r.asset_id}`} className="font-medium text-slate-900 hover:underline">{r.assets.name}</Link>
                        <div className="truncate text-xs text-slate-500">{r.company_name}</div>
                        {(r.business_type || r.status !== "ACTIVE") && <div className="truncate text-xs text-slate-400">{[r.business_type, r.status !== "ACTIVE" ? "ไม่ได้ถือแล้ว" : null].filter(Boolean).join(" · ")}</div>}
                      </div>
                    </div>
                  </td>
                  <td className={num}>{money(regCapital(r))}
                    {r.total_shares != null && <div className="text-xs text-slate-400">{qty(r.total_shares)} หุ้น</div>}</td>
                  <td className={num}>{fmtPct(companyPct(r))}
                    {sh != null && <div className="text-xs text-slate-400">{qty(sh)} หุ้น</div>}</td>
                  <td className={num}>{money(costOf(r))}
                    {costPerShare != null && <div className="text-xs text-slate-400">หุ้นละ {money(costPerShare, undefined, 2)}</div>}</td>
                  <td className={`${num} font-medium`}>{money(myValue(r))}
                    <div className={`text-xs font-normal ${stale ? "text-amber-700" : "text-slate-400"}`}>ณ {thDate(r.assets.current_value_date)}{stale && " · เกิน 1 ปี"}</div>
</td>
                  <td className={`${num} ${vc == null ? "text-slate-400" : vc >= 0 ? "text-emerald-700" : "text-red-700"}`}>{vc == null ? "-" : `${vc >= 0 ? "+" : ""}${vc.toLocaleString("th-TH", { maximumFractionDigits: 1 })}%`}</td>
                  <td className={`${num} ${dv > 0 ? "text-emerald-700" : "text-slate-400"}`}>{money(dv)}</td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
              <tr>
                <td className="px-3 py-3">รวมทั้งหมด</td>
                <td className="px-3 text-right tabular-nums">{money(totals.reg)}</td><td className="px-3 text-right text-slate-400">-</td>
                <td className="px-3 text-right tabular-nums">{money(totals.cost)}</td>
                <td className="px-3 text-right tabular-nums">{money(totals.val)}</td>
                <td className={`px-3 text-right tabular-nums ${totals.cost <= 0 ? "text-slate-400" : totals.val >= totals.cost ? "text-emerald-700" : "text-red-700"}`}>{totals.cost > 0 ? `${totals.val >= totals.cost ? "+" : ""}${(((totals.val - totals.cost) * 100) / totals.cost).toLocaleString("th-TH", { maximumFractionDigits: 1 })}%` : "-"}</td>
                <td className="px-3 text-right tabular-nums text-emerald-700">{money(totals.div)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      </TabPanel>

      <TabPanel id="record">
        <BusinessBatch key={ym} rows={batchRows} banks={bizBanks} today={today} defaultDate={defaultDate} minDate={minDate} canWrite={canWrite} />
      </TabPanel>
    </div>
    </TabsProvider>
  );
}

/** ตารางสัดส่วน: ชื่อ · แถบ · มูลค่า · % */
function ShareTable({ label, rows, total }: { label: string; rows: { key: string; name: string; value: number; color: string }[]; total: number }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-xs text-slate-500">
        <tr><th className="px-3 py-2">{label}</th><th className="px-3"></th><th className="px-3 text-right">มูลค่า (THB)</th><th className="px-3 text-right">สัดส่วน</th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => {
          const pct = total > 0 ? (r.value * 100) / total : 0;
          return (
            <tr key={r.key}>
              <td className="whitespace-nowrap px-3 py-2"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: r.color }} />{r.name}</td>
              <td className="w-2/5 px-3"><div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: r.color }} /></div></td>
              <td className="whitespace-nowrap px-3 text-right tabular-nums">{money(r.value, undefined, 0)}</td>
              <td className="px-3 text-right tabular-nums">{pct.toFixed(1)}%</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
