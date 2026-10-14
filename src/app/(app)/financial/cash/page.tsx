import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ACCOUNT_TYPE_LABEL, money, thDate } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import { MoveButtons, SortToggle, bySort, neighbors } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";

type Row = {
  asset_id: string; name: string; currency: string; bank_name: string; account_type: string;
  account_no_masked: string | null; status: string;
};
type Bal = { asset_id: string; confirmed_balance: number | null; confirmed_date: string | null;
  calculated_balance: number | null; balance_label: string };

export default async function CashPage({ searchParams }: { searchParams: Promise<{ p?: string; order?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const pv = await loadPersonView(sp.p);
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder && sp.order === "1";
  const paths = ["/financial/cash"];
  const [{ data: accounts, error }, { data: balances }, { data: owners }, sortMap] = await Promise.all([
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,bank_name,account_type,account_no_masked,status").order("name"),
    supabase.from("v_bank_balance_current").select("asset_id,confirmed_balance,confirmed_date,calculated_balance,balance_label"),
    supabase.from("v_asset_ownerships_active").select("asset_id,person_name,ownership_percent,end_date"),
    loadSortMap("assets"),
  ]);
  const bal = new Map((balances as Bal[] | null ?? []).map((b) => [b.asset_id, b]));
  const ownersOf = (id: string) => (owners ?? []).filter((o) => o.asset_id === id && !o.end_date)
    .map((o) => `${o.person_name} ${Number(o.ownership_percent)}%`).join(", ");

  const list = bySort((accounts as Row[] | null ?? []).filter((a) => pv.showAsset(a.asset_id)), (a) => a.asset_id, sortMap);
  const totals = new Map<string, number>();
  list.filter((a) => a.status === "ACTIVE").forEach((a) => {
    const v = Number(bal.get(a.asset_id)?.calculated_balance ?? 0) * pv.assetShare(a.asset_id);
    totals.set(a.currency, (totals.get(a.currency) ?? 0) + v);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Cash &amp; Bank Accounts</h1>
          <p className="text-sm text-slate-500">บัญชีเงินฝากทั้งหมดของครอบครัว</p>
        </div>
        <div className="flex items-start gap-2">
          <PersonFilter persons={pv.persons} value={pv.personId} />
          {me.role !== "VIEWER" && (
            <Link href="/financial/cash/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
              + เพิ่มบัญชี
            </Link>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}

      {totals.size > 0 && (
        <div className="flex flex-wrap gap-3">
          {[...totals.entries()].map(([ccy, v]) => (
            <div key={ccy} className="rounded-xl border border-slate-200 bg-white px-5 py-3">
              <div className="text-xs text-slate-500">รวม {ccy}</div>
              <div className="text-lg font-semibold tabular-nums">{money(v, ccy)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex items-baseline gap-3 px-4 pt-4">
          <h2 className="font-medium text-slate-900">บัญชีทั้งหมด</h2>
          {canOrder && list.length > 1 && <SortToggle active={ordering} {...orderHrefs("/financial/cash", { p: sp.p })} />}
        </div>
        <table className="mt-2 w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">บัญชี</th><th className="px-4">เจ้าของ</th>
              <th className="px-4 text-right">ยอดคงเหลือ</th><th className="px-4">สถานะยอด</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">{pv.personId ? `ไม่มีบัญชีของ ${pv.personName}` : "ยังไม่มีบัญชี"}</td></tr>
            )}
            {list.map((a, i) => {
              const b = bal.get(a.asset_id);
              return (
                <tr key={a.asset_id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    {ordering && <span className="mr-2 align-middle"><MoveButtons table="assets" id={a.asset_id} paths={paths} {...neighbors(list, i, (x) => x.asset_id)} /></span>}
                    <Link href={`/financial/cash/${a.asset_id}`} className="font-medium text-slate-900 hover:underline">{a.name}</Link>
                    <div className="text-xs text-slate-500">
                      {a.bank_name} · {ACCOUNT_TYPE_LABEL[a.account_type] ?? a.account_type}
                      {a.account_no_masked && ` · ${a.account_no_masked}`}
                      {a.status !== "ACTIVE" && ` · ${a.status}`}
                    </div>
                  </td>
                  <td className="px-4 text-slate-600">{ownersOf(a.asset_id) || <span className="text-amber-700">ยังไม่ระบุเจ้าของ</span>}</td>
                  <td className="px-4 text-right tabular-nums">
                    {money(b?.calculated_balance == null ? null : Number(b.calculated_balance) * pv.assetShare(a.asset_id), a.currency)}
                    {pv.assetPct(a.asset_id) != null && <div className="text-xs text-slate-400">{pv.assetPct(a.asset_id)}% ของ {money(b?.calculated_balance, a.currency)}</div>}
                  </td>
                  <td className="px-4 text-xs">
                    {b?.balance_label === "CALCULATED"
                      ? <span className="text-amber-700">คำนวณ (ยืนยันล่าสุด {thDate(b?.confirmed_date)})</span>
                      : <span className="text-emerald-700">ยืนยันแล้ว {thDate(b?.confirmed_date)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
