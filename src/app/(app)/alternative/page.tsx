import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { addDays, money, qtyUnit, thDate, todayBangkok } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import { HeaderFilters } from "@/components/HeaderBar";
import { MoveButtons, SortToggle, bySort, neighbors } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";
import ShareTable, { SHARE_COLORS } from "@/components/ShareTable";
import { TabNav, TabPanel, TabsProvider } from "@/components/ClientTabs";
import AltBatch, { type AltRow } from "./AltBatch";
import { recEdit, recLabel } from "@/lib/recorded-edit";
import { assetIncomeFields } from "@/lib/source-edit";

type Cat = { id: string; category_name: string; category_code: string; default_unit: string | null };
const TABS = [["overview", "ภาพรวม"], ["record", "บันทึกรับผลตอบแทน/อัพเดตมูลค่า"]] as const;

type Row = { id: string; asset_id: string; category_id: string; quantity: number | null; unit: string | null; purity_pct: number | null; auto_price: boolean | null;
  brand: string | null; model: string | null; storage_location: string | null;
  asset_categories: Cat | Cat[] | null;
  assets: { name: string; currency: string; current_value: number | null; current_value_date: string | null; status: string; acquisition_cost: number | null } };
type Own = { asset_id: string; person_id: string; ownership_percent: number; end_date: string | null };

const COLORS = SHARE_COLORS;
/** ตัวย่อบนป้าย: ตัวอักษรภาษาอังกฤษ / ตัวเลข 4 ตัวแรก (ไม่มี = 2 ตัวแรก) */
const initials = (name: string) => { const l = name.replace(/[^A-Za-z0-9]/g, ""); return (l || name).slice(0, l ? 4 : 2).toUpperCase(); };

export default async function AlternativePage({ searchParams }: { searchParams: Promise<{ p?: string; order?: string; c?: string; tab?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const pv = await loadPersonView(sp.p);
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder && sp.order === "1";
  const paths = ["/alternative"];
  const [sortMap, { data, error }, { data: owners }, { data: fx }, { data: banks }, { data: family }] = await Promise.all([
    loadSortMap("assets"),
    supabase.from("alternative_asset_details")
      .select("id,asset_id,category_id,quantity,unit,purity_pct,auto_price,brand,model,storage_location,asset_categories(id,category_name,category_code,default_unit),assets!inner(name,currency,current_value,current_value_date,status,acquisition_cost,deleted_at)")
      .is("deleted_at", null).is("assets.deleted_at", null).order("created_at"),
    supabase.from("v_asset_ownerships_active").select("asset_id,person_id,ownership_percent,end_date"),
    supabase.from("v_fx_status").select("currency,rate_to_thb"),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("families").select("go_live_date").maybeSingle(),
  ]);
  const rate = new Map<string, number>([["THB", 1], ...((fx ?? []).map((r) => [r.currency as string, Number(r.rate_to_thb)] as [string, number]))]);
  const thb = (v: number | null | undefined, c: string) => (v == null ? null : Number(v) * (rate.get(c) ?? 0));
  const all = (data as unknown as Row[] | null) ?? [];
  const catOf = (r: Row) => (Array.isArray(r.asset_categories) ? r.asset_categories[0] : r.asset_categories) ?? null;
  const color = new Map<string, string>();
  [...new Set(all.map((r) => r.category_id))].forEach((c, i) => color.set(c, COLORS[i % COLORS.length]));
  const mine = bySort(all.filter((r) => pv.showAsset(r.asset_id)), (r) => r.asset_id, sortMap);
  const cats = [...new Map(mine.map((r) => [r.category_id, catOf(r)?.category_name ?? "-"]))];
  const catFilter = cats.some(([k]) => k === sp.c) ? sp.c : undefined;
  const rows = catFilter ? mine.filter((r) => r.category_id === catFilter) : mine;
  const share = (id: string) => pv.assetShare(id);
  const valueOf = (r: Row) => { const v = thb(r.assets.current_value, r.assets.currency); return v == null ? null : v * share(r.asset_id); };
  const costOf = (r: Row) => { const v = thb(r.assets.acquisition_cost, r.assets.currency); return v == null ? null : v * share(r.asset_id); };
  const unitOf = (r: Row) => r.unit ?? catOf(r)?.default_unit ?? null;
  const per = (v: number | null, r: Row) => (v == null || !r.quantity ? null : v / (Number(r.quantity) * share(r.asset_id)));
  const vs = (r: Row) => { const v = valueOf(r), c = costOf(r); return v == null || !c ? null : ((v - c) * 100) / c; };
  const pctText = (v: number) => `${v >= 0 ? "+" : ""}${v.toLocaleString("th-TH", { maximumFractionDigits: 1 })}%`;
  const old = addDays(todayBangkok(), -90);

  // กล่องสรุป: ตามหมวด (ตามสมาชิกที่เลือก) · ตามสมาชิก (ทั้งครอบครัวเสมอ)
  const active = mine.filter((r) => r.assets.status === "ACTIVE" && (valueOf(r) ?? 0) > 0);
  const totalMine = active.reduce((t, r) => t + (valueOf(r) ?? 0), 0);
  const byCat = new Map<string, number>();
  active.forEach((r) => byCat.set(r.category_id, (byCat.get(r.category_id) ?? 0) + (valueOf(r) ?? 0)));
  const famActive = all.filter((r) => r.assets.status === "ACTIVE");
  const ownRows = ((owners ?? []) as Own[]).filter((o) => !o.end_date);
  const byPerson = new Map<string, number>();
  famActive.forEach((r) => ownRows.filter((o) => o.asset_id === r.asset_id).forEach((o) =>
    byPerson.set(o.person_id, (byPerson.get(o.person_id) ?? 0) + (thb(r.assets.current_value, r.assets.currency) ?? 0) * Number(o.ownership_percent) / 100)));
  const totalFam = [...byPerson.values()].reduce((t, v) => t + v, 0);
  const personName = new Map(pv.persons.map((x) => [x.id, x.name]));
  const totals = { cost: rows.reduce((t, r) => t + (costOf(r) ?? 0), 0), val: rows.reduce((t, r) => t + (valueOf(r) ?? 0), 0) };
  const href = (c?: string) => { const q = new URLSearchParams(); if (sp.p) q.set("p", sp.p); if (c) q.set("c", c); const s = q.toString(); return `/alternative${s ? `?${s}` : ""}`; };
  const num = "px-3 py-3 align-top text-right tabular-nums";

  // แท็บบันทึกทั้งชุด: สินทรัพย์ที่ถืออยู่ (ตามตัวกรองคน) · ทองที่ตั้งราคาอัตโนมัติ (THB) ไม่ต้องกรอกมูลค่า
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as string) : "overview";
  // ผลตอบแทนที่รับแล้วเดือนนี้ (ทีละครั้ง) → กดเพื่อแก้ / ลบ (ตกลง 28 ต.ค. 2026)
  const activeIds = mine.filter((r) => r.assets.status === "ACTIVE").map((r) => r.asset_id);
  const monthStart = `${todayBangkok().slice(0, 7)}-01`;
  const { data: gotRaw } = activeIds.length ? await supabase.from("income_transactions").select("id,asset_id,date,amount,tax,notes,currency")
    .in("asset_id", activeIds).eq("income_type", "OTHER").eq("pending_split", false).gte("date", monthStart).is("deleted_at", null).order("date")
    : { data: [] as { id: string; asset_id: string; date: string; amount: number; tax: number | null; notes: string | null; currency: string }[] };
  const batchRows: AltRow[] = mine.filter((r) => r.assets.status === "ACTIVE").map((r) => ({
    edits: (gotRaw ?? []).filter((i) => i.asset_id === r.asset_id).map((i) => ({ id: i.id as string, node: recEdit({
      canWrite: me.role !== "VIEWER", canDelete: canOrder, table: "income_transactions", id: i.id as string,
      label: recLabel("รับแล้ว", i.date as string, Number(i.amount) - Number(i.tax ?? 0), i.currency as string),
      paths: ["/alternative", `/alternative/${r.asset_id}`, "/income-expenses"], fields: assetIncomeFields(i as { date: string; amount: number }) }) })),
    id: r.asset_id, name: r.assets.name, category: catOf(r)?.category_name ?? "-", currency: r.assets.currency,
    value: r.assets.current_value != null ? Number(r.assets.current_value) : null, valueDate: r.assets.current_value_date,
    auto: !!r.auto_price && catOf(r)?.category_code === "GOLD" && r.assets.currency === "THB" }));

  return (
    <TabsProvider initial={tab} defaultKey="overview">
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">ทอง เครื่องประดับ นาฬิกา ของสะสม คริปโต และอื่น ๆ</p>
        </div>
        <div className="flex items-start gap-2">
          <HeaderFilters><PersonFilter persons={pv.persons} value={pv.personId} /></HeaderFilters>
          {me.role !== "VIEWER" && <Link href="/alternative/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มสินทรัพย์</Link>}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      <div className="border-b border-slate-200"><TabNav tabs={TABS} /></div>

      <TabPanel id="record">
        <AltBatch key={batchRows.map((r) => r.id).join()} rows={batchRows} banks={(banks ?? []).map((b) => ({ id: b.asset_id, name: b.name, currency: b.currency }))}
          today={todayBangkok()} minDate={family?.go_live_date ?? ""} canWrite={me.role !== "VIEWER"} />
      </TabPanel>

      <TabPanel id="overview" className="space-y-6">

      {totalMine > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-medium text-slate-900">สัดส่วนมูลค่าตามหมวด{pv.personId ? `ของ ${pv.personName}` : ""}</h2>
            <p className="mb-3 text-xs text-slate-500">รวม {money(totalMine, "THB")} · {active.length} รายการ</p>
            <ShareTable label="หมวด" total={totalMine} rows={[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({
              key: k, name: `${cats.find(([c]) => c === k)?.[1] ?? "-"} (${active.filter((r) => r.category_id === k).length})`, value: v, color: color.get(k) ?? COLORS[0] }))} />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-medium text-slate-900">มูลค่าตามสมาชิกครอบครัว</h2>
            <p className="mb-3 text-xs text-slate-500">รวม {money(totalFam, "THB")}</p>
            <ShareTable label="สมาชิกครอบครัว" total={totalFam} rows={[...byPerson.entries()].sort((a, b) => b[1] - a[1]).map(([pid, v], i) => ({
              key: pid, name: personName.get(pid) ?? "สมาชิก", value: v, color: COLORS[(i + 1) % COLORS.length] }))} />
          </div>
        </section>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-medium text-slate-900">รายการทั้งหมด</h2>
            {cats.length > 1 && (
              <div className="flex flex-wrap gap-1 text-xs">
                <Link href={href()} scroll={false} className={`rounded-full border px-2.5 py-0.5 ${!catFilter ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>ทั้งหมด</Link>
                {cats.map(([k, l]) => (
                  <Link key={k} href={href(k)} scroll={false}
                    className={`rounded-full border px-2.5 py-0.5 ${catFilter === k ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                    {l} ({mine.filter((r) => r.category_id === k).length})</Link>
                ))}
              </div>
            )}
          </div>
          {canOrder && rows.length > 1 && <SortToggle active={ordering} {...orderHrefs("/alternative", { p: sp.p, c: catFilter })} />}
        </div>
        <table className="mt-2 w-full min-w-[56rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">รายการ</th><th className="px-3 text-right">จำนวน</th><th className="px-3 text-right">ราคาทุน (THB)</th>
              <th className="px-3 text-right">มูลค่าปัจจุบัน (THB)</th><th className="px-3 text-right">เทียบทุน</th><th className="px-3">ที่เก็บ</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">{pv.personId ? `ไม่มีรายการของ ${pv.personName}` : "ยังไม่มีรายการ"}</td></tr>}
            {rows.map((r, i) => {
              const c = catOf(r);
              const stale = !r.assets.current_value_date || r.assets.current_value_date < old;
              const u = unitOf(r);
              const v = valueOf(r), cost = costOf(r), x = vs(r);
              return (
                <tr key={r.id} className={r.assets.status !== "ACTIVE" ? "opacity-50" : ""}>
                  <td className="px-3 py-3 align-top">
                    <div className="flex items-start gap-3">
                      {ordering && <MoveButtons table="assets" id={r.asset_id} paths={paths} {...neighbors(rows, i, (y) => y.asset_id)} />}
                      <span className="inline-flex h-9 w-11 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold text-white"
                        style={{ background: color.get(r.category_id) }}>{initials(r.assets.name)}</span>
                      <div className="min-w-0">
                        <Link href={`/alternative/${r.asset_id}`} className="font-medium text-slate-900 hover:underline">{r.assets.name}</Link>
                        <div className="truncate text-xs text-slate-500">{c?.category_name ?? "-"}</div>
                        {(r.brand || r.model || r.assets.status !== "ACTIVE") && <div className="truncate text-xs text-slate-400">
                          {[r.brand, r.model, r.assets.status !== "ACTIVE" ? "ไม่ได้ถือแล้ว" : null].filter(Boolean).join(" · ")}</div>}
                      </div>
                    </div>
                  </td>
                  <td className={num}>{qtyUnit(r.quantity, u)}
                    {r.purity_pct != null && <div className="text-xs text-slate-400">ความบริสุทธิ์ {Number(r.purity_pct)}%</div>}
                    {pv.assetPct(r.asset_id) != null && <div className="text-xs text-slate-400">ถือ {pv.assetPct(r.asset_id)}%</div>}</td>
                  <td className={num}>{money(cost)}
                    {per(cost, r) != null && <div className="text-xs text-slate-400">{u ?? "หน่วย"}ละ {money(per(cost, r))}</div>}</td>
                  <td className={`${num} font-medium`}>{money(v)}
                    {per(v, r) != null && <div className="text-xs font-normal text-slate-400">{u ?? "หน่วย"}ละ {money(per(v, r))}</div>}
                    <div className={`text-xs font-normal ${stale ? "text-amber-700" : "text-slate-400"}`}>ณ {thDate(r.assets.current_value_date)}{stale && " · เกิน 90 วัน"}</div></td>
                  <td className={`${num} ${x == null ? "text-slate-400" : x >= 0 ? "text-emerald-700" : "text-red-700"}`}>{x == null ? "-" : pctText(x)}</td>
                  <td className="px-3 py-3 align-top text-xs text-slate-600">{r.storage_location || "-"}</td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
              <tr>
                <td className="px-3 py-3">รวม{catFilter ? "ตามหมวด" : "ทั้งหมด"}</td><td className="px-3 text-right text-slate-400">-</td>
                <td className="px-3 text-right tabular-nums">{money(totals.cost)}</td>
                <td className="px-3 text-right tabular-nums">{money(totals.val)}</td>
                <td className={`px-3 text-right tabular-nums ${totals.cost <= 0 ? "text-slate-400" : totals.val >= totals.cost ? "text-emerald-700" : "text-red-700"}`}>
                  {totals.cost > 0 ? pctText(((totals.val - totals.cost) * 100) / totals.cost) : "-"}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-slate-500">มูลค่าสกุลอื่นแปลงเป็นบาทด้วยอัตราล่าสุด · ทองคำ 1 บาททองคำ = 15.244 กรัม · ต่อหน่วย = มูลค่า ÷ จำนวน</p>
      </TabPanel>
    </div>
    </TabsProvider>
  );
}
