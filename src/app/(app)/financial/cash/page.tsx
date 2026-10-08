import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ACCOUNT_TYPE_LABEL, money, thDate } from "@/lib/format";

type Row = {
  asset_id: string; name: string; currency: string; bank_name: string; account_type: string;
  account_no_masked: string | null; status: string;
};
type Bal = { asset_id: string; confirmed_balance: number | null; confirmed_date: string | null;
  calculated_balance: number | null; balance_label: string };

export default async function CashPage() {
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: accounts, error }, { data: balances }, { data: owners }] = await Promise.all([
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,bank_name,account_type,account_no_masked,status").order("name"),
    supabase.from("v_bank_balance_current").select("asset_id,confirmed_balance,confirmed_date,calculated_balance,balance_label"),
    supabase.from("v_asset_ownerships_active").select("asset_id,person_name,ownership_percent,end_date"),
  ]);
  const bal = new Map((balances as Bal[] | null ?? []).map((b) => [b.asset_id, b]));
  const ownersOf = (id: string) => (owners ?? []).filter((o) => o.asset_id === id && !o.end_date)
    .map((o) => `${o.person_name} ${Number(o.ownership_percent)}%`).join(", ");

  const totals = new Map<string, number>();
  (accounts as Row[] | null ?? []).filter((a) => a.status === "ACTIVE").forEach((a) => {
    const v = Number(bal.get(a.asset_id)?.calculated_balance ?? 0);
    totals.set(a.currency, (totals.get(a.currency) ?? 0) + v);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Cash &amp; Deposits</h1>
          <p className="text-sm text-slate-500">บัญชีเงินฝากทั้งหมดของครอบครัว</p>
        </div>
        {me.role !== "VIEWER" && (
          <Link href="/financial/cash/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
            + เพิ่มบัญชี
          </Link>
        )}
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
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">บัญชี</th><th className="px-4">เจ้าของ</th>
              <th className="px-4 text-right">ยอดคงเหลือ</th><th className="px-4">สถานะยอด</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(accounts as Row[] | null ?? []).length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">ยังไม่มีบัญชี</td></tr>
            )}
            {(accounts as Row[] | null ?? []).map((a) => {
              const b = bal.get(a.asset_id);
              return (
                <tr key={a.asset_id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/financial/cash/${a.asset_id}`} className="font-medium text-slate-900 hover:underline">{a.name}</Link>
                    <div className="text-xs text-slate-500">
                      {a.bank_name} · {ACCOUNT_TYPE_LABEL[a.account_type] ?? a.account_type}
                      {a.account_no_masked && ` · ${a.account_no_masked}`}
                      {a.status !== "ACTIVE" && ` · ${a.status}`}
                    </div>
                  </td>
                  <td className="px-4 text-slate-600">{ownersOf(a.asset_id) || <span className="text-amber-700">ยังไม่ระบุเจ้าของ</span>}</td>
                  <td className="px-4 text-right tabular-nums">{money(b?.calculated_balance, a.currency)}</td>
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
