"use client";

import { useActionState } from "react";
import { addAssetValuation, type RecState } from "@/lib/records";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";

export default function AssetValuationForm({ assetId, currency, today, minDate, paths, methods }: {
  assetId: string; currency: string; today: string; minDate: string; paths: string[]; methods?: [string, string][];
}) {
  const [state, action, pending] = useActionState<RecState, FormData>(addAssetValuation, {});
  const opts = methods ?? [["USER_ESTIMATE", "ประมาณเอง"], ["APPRAISAL", "ผู้ประเมิน"], ["LATEST_TRANSACTION", "ราคาซื้อขายล่าสุด"]];
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="paths" value={paths.join(",")} />
      <label className="text-sm">มูลค่า ({currency})<input name="value" required inputMode="decimal" className={`mt-1 block w-44 ${input}`} /></label>
      <label className="text-sm">ณ วันที่<input name="valuation_date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 block ${input}`} /></label>
      <label className="text-sm">วิธี
        <select name="valuation_method" defaultValue={opts[0][0]} className={`mt-1 block ${input}`}>
          {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="min-w-48 flex-1 text-sm">หมายเหตุ<input name="notes" className={`mt-1 block w-full ${input}`} /></label>
      <button disabled={pending} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึกมูลค่า"}</button>
      <div className="w-full">
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.ok && <p className="text-sm text-emerald-700">{state.ok}</p>}
      </div>
    </form>
  );
}
