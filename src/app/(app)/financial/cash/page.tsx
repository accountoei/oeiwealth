import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ACCOUNT_TYPE_LABEL, bankLabel, money, monthOptions, monthRange, todayBangkok } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import MonthPicker from "@/components/MonthPicker";
import { MoveButtons, SortToggle, bySort, neighbors } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";
import { TabNav, TabPanel, TabsProvider } from "../../income-expenses/tabs";
import ShareBars, { type BarRow } from "./ShareBars";
import AccountsTable, { type AccountRow } from "./AccountsTable";
import BatchUpdate, { type BatchRow } from "./BatchUpdate";

type Acc = { asset_id: string; name: string; currency: string; bank_name: string; account_type: string;
  account_no_masked: string | null; status: string; interest_rate: number | null; maturity_date: string | null };
type Sum = { asset_id: string; balance: number | null; prev_balance: number | null; inflow: number; outflow: number;
  internal_in: number; internal_out: number; n_in: number; n_out: number };
type At = { asset_id: string; calculated: number | null; last_date: string | null; last_value: number | null };

// บัญชีทั้งหมดอยู่ท้ายแท็บภาพรวม (ลิงก์เดิม ?tab=accounts → ภาพรวม)
const TABS: [string, string][] = [["overview", "ภาพรวม"], ["update", "อัปเดตยอดคงเหลือ"]];
const TYPE_COLORS = ["#2563eb", "#059669", "#f59e0b", "#94a3b8"];
const BANK_COLORS = ["#2563eb", "#f59e0b", "#059669", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#ea580c", "#475569"];
const PERSON_COLORS = ["#3b82f6", "#ec4899", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#84cc16"];
const CCY_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ec4899"];

type Sp = Promise<{ tab?: string; m?: string; p?: string; d?: string; order?: string }>;

export default async function CashPage({ searchParams }: { searchParams: Sp }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const today = todayBangkok();
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as string) : "overview";
  const ym = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? (sp.m as string) : today.slice(0, 7);
  const { start, end, prev } = monthRange(ym);
  const prevStart = `${prev}-01`;
  const asOf = end < today ? end : today;
  const upDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? "") && (sp.d as string) <= today ? (sp.d as string) : today;
  const pv = await loadPersonView(sp.p);
  const canWrite = me.role !== "VIEWER";
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder && sp.order === "1";
  const paths = ["/financial/cash"];

  const [{ data: accounts, error }, { data: owners }, { data: fx }, { data: sumRaw }, { data: prevRaw }, { data: atRaw },
    { data: lumpE }, { data: lumpI }, { data: family }, sortMap] = await Promise.all([
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,bank_name,account_type,account_no_masked,status,interest_rate,maturity_date").order("name"),
    supabase.from("v_asset_ownerships_active").select("asset_id,person_id,person_name,ownership_percent,end_date"),
    supabase.from("v_fx_status").select("currency,rate_to_thb"),
    supabase.rpc("bank_month_summary", { p_month: start }),
    supabase.rpc("bank_month_summary", { p_month: prevStart }),
    supabase.rpc("bank_balances_at", { p_date: upDate }),
    supabase.from("expense_items").select("paid_from_asset_id,date").eq("pending_split", true).eq("lump_kind", "BANK").is("deleted_at", null),
    supabase.from("income_transactions").select("received_to_asset_id,date").eq("pending_split", true).not("received_to_asset_id", "is", null).is("deleted_at", null),
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    loadSortMap("assets"),
  ]);
  const rate = new Map<string, number>([["THB", 1], ...((fx ?? []).map((r) => [r.currency as string, Number(r.rate_to_thb)] as [string, number]))]);
  const thb = (v: number | null | undefined, c: string) => Number(v ?? 0) * (rate.get(c) ?? 0);
  const sum = new Map(((sumRaw as Sum[] | null) ?? []).map((r) => [r.asset_id, r]));
  const prevSum = new Map(((prevRaw as Sum[] | null) ?? []).map((r) => [r.asset_id, r]));
  const at = new Map(((atRaw as At[] | null) ?? []).map((r) => [r.asset_id, r]));
  const lumps = [...(lumpE ?? []).map((x) => ({ id: x.paid_from_asset_id as string, date: x.date as string })),
    ...(lumpI ?? []).map((x) => ({ id: x.received_to_asset_id as string, date: x.date as string }))];
  const hasLump = (id: string, month?: string) => lumps.some((l) => l.id === id && (!month || l.date.startsWith(month)));
  const ownRows = (owners ?? []).filter((o) => !o.end_date);
  const ownersOf = (id: string) => ownRows.filter((o) => o.asset_id === id).map((o) => `${o.person_name} ${Number(o.ownership_percent)}%`).join(", ");

  // ชื่อธนาคารที่พิมพ์ต่างกัน (BBL / กรุงเทพ) → ชื่อมาตรฐานเดียว
  const all = bySort(((accounts as Acc[] | null) ?? []).filter((a) => pv.showAsset(a.asset_id)), (a) => a.asset_id, sortMap)
    .map((a) => ({ ...a, bank_name: bankLabel(a.bank_name) }));
  const share = (id: string) => pv.assetShare(id);
  const active = all.filter((a) => a.status === "ACTIVE" || Math.abs(Number(sum.get(a.asset_id)?.balance ?? 0)) > 0.005);

  // ---------------------------------------------------------------- ภาพรวม (ยอด ณ สิ้นเดือน / วันนี้ · เงินเข้า–ออก ไม่นับโอนระหว่างบัญชีของครอบครัว)
  const tot = (m: Map<string, Sum>, f: (s: Sum) => number) => active.reduce((t, a) => {
    const s = m.get(a.asset_id); return t + (s ? thb(f(s), a.currency) * share(a.asset_id) : 0);
  }, 0);
  const totalNow = tot(sum, (s) => Number(s.balance ?? 0));
  const totalPrev = tot(prevSum, (s) => Number(s.balance ?? 0));
  const inNow = tot(sum, (s) => Number(s.inflow) - Number(s.internal_in));
  const outNow = tot(sum, (s) => Number(s.outflow) - Number(s.internal_out));
  const inPrev = tot(prevSum, (s) => Number(s.inflow) - Number(s.internal_in));
  const outPrev = tot(prevSum, (s) => Number(s.outflow) - Number(s.internal_out));
  const cnt = (f: (s: Sum) => number) => active.reduce((t, a) => t + (sum.get(a.asset_id) ? f(sum.get(a.asset_id)!) : 0), 0);
  const pct = (a: number, b: number) => (Math.abs(b) < 0.005 ? null : ((a - b) / Math.abs(b)) * 100);
  const byCcy = [...active.reduce((m, a) => m.set(a.currency, (m.get(a.currency) ?? 0) + Number(sum.get(a.asset_id)?.balance ?? 0) * share(a.asset_id)),
    new Map<string, number>())].filter(([, v]) => Math.abs(v) > 0.005).sort((a, b) => thb(b[1], b[0]) - thb(a[1], a[0]));

  const bankRows: BarRow[] = [...active.reduce((m, a) => m.set(a.bank_name, (m.get(a.bank_name) ?? 0) + thb(Number(sum.get(a.asset_id)?.balance ?? 0), a.currency) * share(a.asset_id)),
    new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ key: k, label: k, value: v, color: BANK_COLORS[i % BANK_COLORS.length] }));
  const personRows: BarRow[] = pv.persons.map((p, i) => ({
    key: p.id, label: p.name, color: PERSON_COLORS[i % PERSON_COLORS.length],
    value: active.reduce((t, a) => t + thb(Number(sum.get(a.asset_id)?.balance ?? 0), a.currency)
      * ownRows.filter((o) => o.asset_id === a.asset_id && o.person_id === p.id).reduce((s, o) => s + Number(o.ownership_percent), 0) / 100, 0),
  }));
  // ตามประเภทบัญชี (ออมทรัพย์ / ฝากประจำ / เงินตราต่างประเทศ / อื่น ๆ)
  const typeRows: BarRow[] = ["SAVING", "FIXED", "FOREIGN_CURRENCY", "OTHER"].map((t, i) => ({
    key: t, label: ACCOUNT_TYPE_LABEL[t] ?? t, color: TYPE_COLORS[i],
    value: active.filter((a) => (["SAVING", "FIXED", "FOREIGN_CURRENCY"].includes(a.account_type) ? a.account_type : "OTHER") === t)
      .reduce((v, a) => v + thb(Number(sum.get(a.asset_id)?.balance ?? 0), a.currency) * share(a.asset_id), 0),
  }));
  const ownGap = active.filter((a) => a.status === "ACTIVE"
    && Math.abs(ownRows.filter((o) => o.asset_id === a.asset_id).reduce((s, o) => s + Number(o.ownership_percent), 0) - 100) > 0.01);

  // ---------------------------------------------------------------- บัญชีทั้งหมด
  const accountRows: AccountRow[] = all.map((a, i) => {
    const s = sum.get(a.asset_id);
    const full = s?.balance == null ? null : Number(s.balance);
    const bal = full == null ? null : full * share(a.asset_id);
    const lastDate = at.get(a.asset_id)?.last_date ?? null;
    return {
      id: a.asset_id, name: a.name, bank: a.bank_name, type: ACCOUNT_TYPE_LABEL[a.account_type] ?? a.account_type,
      masked: a.account_no_masked, owners: ownersOf(a.asset_id), currency: a.currency, status: a.status,
      balance: bal, thb: thb(bal, a.currency), pct: pv.assetPct(a.asset_id), full,
      lastDate, calculated: !!lastDate && lastDate < asOf,
      rate: a.interest_rate == null ? null : Number(a.interest_rate), maturity: a.maturity_date,
      move: ordering ? <MoveButtons table="assets" id={a.asset_id} paths={paths} {...neighbors(all, i, (x) => x.asset_id)} /> : undefined,
    };
  });

  // ---------------------------------------------------------------- อัปเดตยอดคงเหลือ (บัญชีที่ใช้งานอยู่)
  const batchRows: BatchRow[] = all.filter((a) => a.status === "ACTIVE").map((a) => {
    const x = at.get(a.asset_id);
    return { id: a.asset_id, name: a.name, bank: a.bank_name, currency: a.currency,
      lastDate: x?.last_date ?? null, lastValue: x?.last_value == null ? null : Number(x.last_value),
      calculated: x?.calculated == null ? null : Number(x.calculated), pendingLump: hasLump(a.asset_id, upDate.slice(0, 7)) };
  });
  const minDate = family?.system_status === "SETUP" ? "" : family?.go_live_date ?? "";
  const months = monthOptions(family?.go_live_date, today, 0, ym);
  const Delta = ({ v, good = "up" }: { v: number | null; good?: "up" | "down" }) => v == null ? <span className="text-slate-400">ไม่มีข้อมูลเดือนก่อน</span> : (
    <span className={(v >= 0) === (good === "up") ? "text-emerald-700" : "text-red-700"}>{v >= 0 ? "▲" : "▼"} {Math.abs(v).toFixed(1)}% จากเดือนก่อน</span>
  );
  const movesHref = `/income-expenses?tab=moves&m=${ym}${pv.personId ? `&p=${pv.personId}` : ""}`;

  return (
    <TabsProvider initial={tab}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Cash &amp; Bank Accounts</h1>
          <p className="text-sm text-slate-500">บัญชีเงินฝากทั้งหมดของครอบครัว · ยอดเงินฝาก · เงินเข้า–ออก · อัปเดตยอดคงเหลือ</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <PersonFilter persons={pv.persons} value={pv.personId} />
          <MonthPicker months={months} value={ym} />
          {canWrite && (
            <Link href="/financial/cash/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มบัญชี</Link>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      <TabNav tabs={TABS} />

      <TabPanel id="overview">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
            <div className="text-xs text-slate-500">ยอดเงินฝากรวม (THB Equivalent){asOf < end ? " · ถึงวันนี้" : ""}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{money(totalNow, "THB")}</div>
            <div className="mt-1 text-xs"><Delta v={pct(totalNow, totalPrev)} /> {Math.abs(totalPrev) > 0.005 && <span className="text-slate-400">({money(totalPrev, undefined, 0)})</span>}</div>
            {byCcy.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs">
                {byCcy.map(([c, v], i) => (
                  <li key={c} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: CCY_COLORS[i % CCY_COLORS.length] }} />{c}</span>
                    <span className="tabular-nums text-slate-700">{money(v)}{c !== "THB" && <span className="ml-1 text-slate-400">({money(thb(v, c), "THB")})</span>}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
            <div className="text-xs text-slate-500">เงินเข้าบัญชีเดือนนี้</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">+{money(inNow, "THB")}</div>
            <div className="mt-1 text-xs text-slate-500">{cnt((s) => Number(s.n_in))} รายการ</div>
            <div className="mt-1 text-xs"><Delta v={pct(inNow, inPrev)} /></div>
            <Link href={movesHref} className="mt-2 inline-block text-xs text-blue-700 hover:underline">ดูรายการเงินเข้า–ออก →</Link>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
            <div className="text-xs text-slate-500">เงินออกจากบัญชีเดือนนี้</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-red-700">−{money(outNow, "THB")}</div>
            <div className="mt-1 text-xs text-slate-500">{cnt((s) => Number(s.n_out))} รายการ</div>
            <div className="mt-1 text-xs"><Delta v={pct(outNow, outPrev)} good="down" /></div>
            <Link href={movesHref} className="mt-2 inline-block text-xs text-blue-700 hover:underline">ดูรายการเงินเข้า–ออก →</Link>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
            <div className="text-xs text-slate-500">เงินเคลื่อนไหวสุทธิ</div>
            <div className={`mt-1 text-xl font-semibold tabular-nums ${inNow - outNow >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {inNow - outNow >= 0 ? "+" : "−"}{money(Math.abs(inNow - outNow), "THB")}</div>
            <div className="mt-1 text-xs text-slate-500">เงินเข้า − เงินออก</div>
            <div className="mt-1 text-xs">
              {(() => { const d = (inNow - outNow) - (inPrev - outPrev); return (
                <span className={d >= 0 ? "text-emerald-700" : "text-red-700"}>{d >= 0 ? "▲ เพิ่มขึ้น" : "▼ ลดลง"}จากเดือนก่อน {money(Math.abs(d))}</span>); })()}
            </div>
          </div>
        </section>
        <p className="-mt-3 text-xs text-slate-500">เงินเข้า–ออกไม่นับเงินโอนระหว่างบัญชีของครอบครัวเอง · ยอดสกุลอื่นแปลงเป็นบาทด้วยอัตราล่าสุด</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <ShareBars title="เงินฝากตามธนาคาร" rows={bankRows} />
          <div className="flex flex-col gap-4">
          {pv.personId
            ? <ShareBars title="เงินฝากตามสมาชิกครอบครัว" rows={personRows.filter((r) => r.key === pv.personId)} note={`แสดงเฉพาะ ${pv.personName} · เลือก "ทั้งครอบครัว" เพื่อดูทุกคน`} />
            : <ShareBars title="เงินฝากตามสมาชิกครอบครัว" rows={personRows}
                footer={ownGap.length > 0 && <p className="mt-3 text-xs text-amber-700">ระบุเจ้าของยังไม่ครบ 100%: {ownGap.map((a) => a.name).join(", ")}</p>} />}
          <ShareBars title="เงินฝากตามประเภทบัญชี" head="ประเภทบัญชี" rows={typeRows} className="flex-1" />
          </div>
        </div>
        <AccountsTable rows={accountRows} today={today} empty={pv.personId ? `ไม่มีบัญชีของ ${pv.personName}` : "ยังไม่มีบัญชี"}
          toggle={canOrder && all.length > 1 ? <SortToggle active={ordering} {...orderHrefs("/financial/cash", { p: sp.p, m: sp.m })} /> : null} />
      </TabPanel>

      <TabPanel id="update">
        <BatchUpdate key={upDate} date={upDate} today={today} minDate={minDate} rows={batchRows} canWrite={canWrite} ym={upDate.slice(0, 7)} />
      </TabPanel>
    </div>
    </TabsProvider>
  );
}
