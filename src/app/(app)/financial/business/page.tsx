import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { addDays, money, qty, thDate, todayBangkok } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import { MoveButtons, SortToggle, bySort, neighbors } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";

type Row = { id: string; asset_id: string; company_name: string; business_type: string | null; company_ownership_percent: number | null;
  total_shares: number | null; shares_owned: number | null;
  status: string; assets: { name: string; currency: string; current_value: number | null; current_value_date: string | null } };
type Own = { asset_id: string; person_id: string; ownership_percent: number; shares: number | null; start_date: string; end_date: string | null };

const COLORS = ["#2563eb", "#7c3aed", "#f43f5e", "#f59e0b", "#8b5cf6", "#10b981", "#0ea5e9", "#ec4899", "#14b8a6", "#64748b"];
/** ตัวย่อบนป้าย: ตัวอักษรภาษาอังกฤษ / ตัวเลข 4 ตัวแรกของชื่อรายการ (ไม่มี = 2 ตัวแรก) */
const initials = (name: string) => {
  const latin = name.replace(/[^A-Za-z0-9]/g, "");
  return (latin || name).slice(0, latin ? 4 : 2).toUpperCase();
};
const SORTS = ["name", "type", "pct", "company", "family", "div", "val", "date"] as const;
type SortKey = (typeof SORTS)[number];

export default async function BusinessPage({ searchParams }: { searchParams: Promise<{ p?: string; order?: string; s?: string; d?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const pv = await loadPersonView(sp.p);
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder && sp.order === "1";
  const paths = ["/financial/business"];
  const sortMap = await loadSortMap("assets");
  const today = todayBangkok();
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const { data, error } = await supabase.from("private_business_details")
    .select("id,asset_id,company_name,business_type,company_ownership_percent,total_shares,shares_owned,status,assets!inner(name,currency,current_value,current_value_date,deleted_at)")
    .is("deleted_at", null).is("assets.deleted_at", null).order("created_at");
  const all = (data as unknown as Row[] | null) ?? [];
  const ids = all.map((r) => r.asset_id);
  const none = Promise.resolve({ data: [] as never[] });
  const [{ data: owners }, { data: divs }, { data: divShares }] = await Promise.all([
    ids.length ? supabase.from("asset_ownerships").select("asset_id,person_id,ownership_percent,shares,start_date,end_date").in("asset_id", ids).is("deleted_at", null) : none,
    ids.length ? supabase.from("income_transactions").select("id,asset_id,base_amount").in("asset_id", ids).eq("income_type", "BUSINESS_DIVIDEND")
      .gte("date", yearStart).lte("date", today).is("deleted_at", null) : none,
    pv.personId ? supabase.from("v_income_by_person").select("income_id,base_amount_share").eq("person_id", pv.personId).eq("income_type", "BUSINESS_DIVIDEND").gte("date", yearStart) : none,
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
  // มูลค่ากิจการทั้งบริษัท = มูลค่าส่วนของครอบครัว ÷ % ที่ครอบครัวถือ
  const companyValue = (r: Row) => { const v = famValue(r); const p = famPct(r); return v == null || !p ? null : (v * 100) / p; };
  const divShare = new Map(((divShares ?? []) as { income_id: string; base_amount_share: number }[]).map((x) => [x.income_id, Number(x.base_amount_share)]));
  const divOf = new Map<string, number>();
  ((divs ?? []) as { id: string; asset_id: string; base_amount: number | null }[]).forEach((x) => {
    const v = pv.personId ? divShare.get(x.id) ?? 0 : Number(x.base_amount ?? 0);
    divOf.set(x.asset_id, (divOf.get(x.asset_id) ?? 0) + v);
  });

  // เรียงตามหัวคอลัมน์ (?s=…&d=desc) · ไม่เลือก = ลำดับที่ตั้งไว้
  const sKey = (SORTS as readonly string[]).includes(sp.s ?? "") ? (sp.s as SortKey) : null;
  const desc = sp.d === "desc";
  const keyOf = (r: Row): string | number => {
    switch (sKey) {
      case "name": return r.assets.name; case "type": return r.business_type ?? "";
      case "pct": return companyPct(r) ?? -1; case "company": return companyValue(r) ?? -1;
      case "family": return myValue(r) ?? -1; case "div": return divOf.get(r.asset_id) ?? 0;
      case "val": return famValue(r) ?? -1; case "date": return r.assets.current_value_date ?? "";
      default: return 0;
    }
  };
  const rows = sKey ? [...rowsBase].sort((a, b) => {
    const x = keyOf(a), y = keyOf(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "th");
    return desc ? -c : c;
  }) : rowsBase;
  const head = (k: SortKey, label: string, right = false) => {
    const active = sKey === k;
    const q = new URLSearchParams();
    if (sp.p) q.set("p", sp.p);
    q.set("s", k);
    if (active && !desc) q.set("d", "desc");
    return (
      <th className={`px-3 py-2 ${right ? "text-right" : ""}`}>
        <Link href={`/financial/business?${q}`} scroll={false} className="inline-flex items-center gap-0.5 whitespace-nowrap hover:text-slate-800">
          {label}<span className={active ? "text-slate-700" : "text-slate-300"}>{active ? (desc ? "▾" : "▴") : "▾"}</span>
        </Link>
      </th>
    );
  };

  // กล่องสรุป: สัดส่วนตามกิจการ · มูลค่าตามสมาชิก (ถือ ณ วันนี้)
  const active = rows.filter((r) => r.status === "ACTIVE" && (myValue(r) ?? 0) > 0);
  const totalFam = active.reduce((t, r) => t + (myValue(r) ?? 0), 0);
  const latestDate = active.map((r) => r.assets.current_value_date ?? "").sort().at(-1) ?? null;
  const byPerson = new Map<string, number>();
  const cur = ((owners ?? []) as Own[]).filter((o) => o.start_date <= today && (!o.end_date || o.end_date >= today));
  active.forEach((r) => {
    const os = cur.filter((o) => o.asset_id === r.asset_id);
    const bySh = os.length > 0 && os.every((o) => o.shares != null);
    const tot = os.reduce((t, o) => t + Number(bySh ? o.shares : o.ownership_percent), 0);
    os.forEach((o) => {
      if (pv.personId && o.person_id !== pv.personId) return;
      const pct = bySh ? (tot > 0 ? Number(o.shares) / tot : 0) : Number(o.ownership_percent) / 100;
      byPerson.set(o.person_id, (byPerson.get(o.person_id) ?? 0) + (famValue(r) ?? 0) * pct);
    });
  });
  const personName = new Map(pv.persons.map((x) => [x.id, x.name]));
  const personRows = [...byPerson.entries()].sort((a, b) => b[1] - a[1]);
  const totals = {
    company: rows.reduce((t, r) => t + (companyValue(r) ?? 0), 0),
    family: rows.reduce((t, r) => t + (myValue(r) ?? 0), 0),
    div: rows.reduce((t, r) => t + (divOf.get(r.asset_id) ?? 0), 0),
    val: rows.reduce((t, r) => t + (famValue(r) ?? 0), 0),
  };
  const who = pv.personId ? pv.personName : "ครอบครัว";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Private Business</h1>
          <p className="text-sm text-slate-500">ธุรกิจของครอบครัว / หุ้นนอกตลาด · ปันผลเป็นรายได้ · เงินลงทุนเพิ่มไม่ใช่ค่าใช้จ่าย</p>
        </div>
        <div className="flex items-start gap-2">
          <PersonFilter persons={pv.persons} value={pv.personId} />
          {me.role !== "VIEWER" && <Link href="/financial/business/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มกิจการ</Link>}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}

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
            <p className="mb-3 text-xs text-slate-500">รวม {money(totalFam, "THB")}{latestDate && ` ณ ${thDate(latestDate)}`}</p>
            <ShareTable label="สมาชิกครอบครัว" rows={personRows.map(([pid, v], i) => ({ key: pid, name: personName.get(pid) ?? "สมาชิก", value: v, color: COLORS[i % COLORS.length] }))} total={totalFam} />
          </div>
        </section>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex items-baseline justify-between gap-3 px-4 pt-4">
          <h2 className="font-medium text-slate-900">กิจการทั้งหมด</h2>
          {canOrder && rows.length > 1 && <SortToggle active={ordering} {...orderHrefs("/financial/business", { p: sp.p })} />}
        </div>
        <table className="mt-2 w-full min-w-[64rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              {head("name", "กิจการ")}{head("type", "ประเภทธุรกิจ")}{head("pct", pv.personId ? `% ที่ ${pv.personName} ถือ` : "% ที่ครอบครัวถือ", true)}
              {head("company", "มูลค่ากิจการ (THB)", true)}{head("family", `มูลค่าส่วนของ${who} (THB)`, true)}{head("div", "ปันผลปีนี้ (THB)", true)}
              {head("val", "มูลค่าประเมินล่าสุด (THB)", true)}{head("date", "ประเมินล่าสุด", true)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-500">{pv.personId ? `ไม่มีกิจการของ ${pv.personName}` : "ยังไม่มีรายการ"}</td></tr>}
            {rows.map((r, i) => {
              const stale = !r.assets.current_value_date || r.assets.current_value_date < old;
              const dv = divOf.get(r.asset_id) ?? 0;
              return (
                <tr key={r.id} className={r.status !== "ACTIVE" ? "opacity-50" : ""}>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      {ordering && <MoveButtons table="assets" id={r.asset_id} paths={paths} {...neighbors(rows, i, (x) => x.asset_id)} />}
                      <span className="inline-flex h-9 w-11 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold text-white"
                        style={{ background: color.get(r.asset_id) }}>{initials(r.assets.name)}</span>
                      <div className="min-w-0">
                        <Link href={`/financial/business/${r.asset_id}`} className="font-medium text-slate-900 hover:underline">{r.assets.name}</Link>
                        <div className="truncate text-xs text-slate-500">{r.company_name}{r.status !== "ACTIVE" && " · ไม่ได้ถือแล้ว"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3">{r.business_type || "-"}</td>
                  <td className="px-3 text-right tabular-nums">{fmtPct(companyPct(r))}
                    {pv.assetShares(r.asset_id) != null && <div className="text-xs text-slate-400">{qty(pv.assetShares(r.asset_id))} หุ้น</div>}</td>
                  <td className="px-3 text-right tabular-nums">{money(companyValue(r))}</td>
                  <td className="px-3 text-right font-medium tabular-nums">{money(myValue(r))}</td>
                  <td className={`px-3 text-right tabular-nums ${dv > 0 ? "text-emerald-700" : "text-slate-400"}`}>{money(dv)}</td>
                  <td className="px-3 text-right tabular-nums">{money(famValue(r))}</td>
                  <td className={`whitespace-nowrap px-3 text-right ${stale ? "text-amber-700" : ""}`}>{thDate(r.assets.current_value_date)}{stale && <div className="text-xs">เกิน 1 ปี</div>}</td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
              <tr>
                <td className="px-3 py-3">รวมทั้งหมด</td><td className="px-3 text-slate-400">-</td><td className="px-3 text-right text-slate-400">-</td>
                <td className="px-3 text-right tabular-nums">{money(totals.company)}</td>
                <td className="px-3 text-right tabular-nums">{money(totals.family)}</td>
                <td className="px-3 text-right tabular-nums text-emerald-700">{money(totals.div)}</td>
                <td className="px-3 text-right tabular-nums">{money(totals.val)}</td>
                <td className="px-3 text-right text-slate-400">-</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
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
