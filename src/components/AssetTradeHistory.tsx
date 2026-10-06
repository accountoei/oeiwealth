import { createClient } from "@/lib/supabase/server";
import { money, thDate } from "@/lib/format";
import RowActions from "@/components/RowActions";

/** รายการจ่ายซื้อ / ขาย ของทรัพย์สิน + สรุปกำไรขาดทุนเมื่อขายแล้ว */
export default async function AssetTradeHistory({ assetId, currency, status, cost, paths, canWrite, canDelete, showMoves = true }: {
  assetId: string; currency: string; status: string; cost: number | null; paths: string[];
  canWrite: boolean; canDelete: boolean; showMoves?: boolean;
}) {
  const supabase = await createClient();
  const [{ data: moves }, { data: saleVal }, { data: lastVal }] = await Promise.all([
    supabase.from("cash_movements").select("id,movement_date,movement_type,amount,fee,currency,description,metadata")
      .or(`from_asset_id.eq.${assetId},to_asset_id.eq.${assetId}`).in("movement_type", ["ASSET_PURCHASE", "ASSET_SALE"])
      .is("deleted_at", null).order("movement_date", { ascending: false }),
    supabase.from("asset_valuations").select("valuation_date,value").eq("asset_id", assetId).eq("notes", "ราคาขาย")
      .is("deleted_at", null).order("valuation_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("asset_valuations").select("valuation_date,value").eq("asset_id", assetId).or("notes.is.null,notes.neq.ราคาขาย")
      .is("deleted_at", null).order("valuation_date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const list = moves ?? [];
  const sale = list.find((m) => m.movement_type === "ASSET_SALE");
  const meta = (sale?.metadata ?? {}) as { sale_price?: number; fee?: number };
  const price = meta.sale_price != null ? Number(meta.sale_price) : saleVal ? Number(saleVal.value) : null;
  const fee = Number(meta.fee ?? 0);
  const paid = list.filter((m) => m.movement_type === "ASSET_PURCHASE").reduce((s, m) => s + Number(m.amount), 0);
  const basis = cost ?? (paid > 0 ? paid : null);
  const sold = status === "SOLD" && price != null;
  if (!sold && (!showMoves || list.length === 0)) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 font-medium text-slate-900">ซื้อ / ขาย</h2>
      {sold && (
        <div className="mb-4 grid gap-3 rounded-lg bg-slate-50 p-4 text-sm md:grid-cols-4">
          <div><div className="text-xs text-slate-500">ราคาขาย {saleVal && `(${thDate(saleVal.valuation_date)})`}</div><div className="font-medium tabular-nums">{money(price, currency, 0)}</div></div>
          <div><div className="text-xs text-slate-500">ค่าใช้จ่ายในการขาย</div><div className="tabular-nums">{money(fee, currency, 0)}</div></div>
          <div><div className="text-xs text-slate-500">ต้นทุน (ราคาที่ได้มา)</div><div className="tabular-nums">{basis != null ? money(basis, currency, 0) : "ยังไม่ได้ระบุ"}</div></div>
          <div>
            <div className="text-xs text-slate-500">กำไร / ขาดทุนจากการขาย</div>
            {basis != null ? (() => { const g = (price ?? 0) - fee - basis; return (
              <div className={`font-semibold tabular-nums ${g >= 0 ? "text-emerald-700" : "text-red-600"}`}>{g >= 0 ? "+" : ""}{money(g, currency, 0)}</div>); })()
              : <div className="text-xs text-amber-700">ใส่ &ldquo;ราคาที่ได้มา&rdquo; เพื่อคำนวณ</div>}
          </div>
          {lastVal && <div className="text-xs text-slate-500 md:col-span-4">
            เทียบมูลค่าล่าสุดก่อนขาย {money(lastVal.value, currency, 0)} ({thDate(lastVal.valuation_date)}) → ส่วนต่าง {money((price ?? 0) - Number(lastVal.value), currency, 0)}
          </div>}
        </div>
      )}
      {showMoves && list.length > 0 && (
        <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
          {list.map((m) => (
            <tr key={m.id}>
              <td className="py-1.5">{thDate(m.movement_date)}</td>
              <td>{m.movement_type === "ASSET_SALE" ? "เงินขาย (สุทธิ) เข้าบัญชี" : "จ่ายซื้อ / จ่ายเพิ่ม"}</td>
              <td className="text-slate-500">{m.description}</td>
              <td className={`text-right tabular-nums ${m.movement_type === "ASSET_SALE" ? "text-emerald-700" : ""}`}>{money(m.amount, m.currency)}</td>
              <td className="pl-2 text-right">{canWrite && <RowActions table="cash_movements" id={m.id} paths={paths} canDelete={canDelete} canEdit={m.movement_type === "ASSET_PURCHASE"}
                deleteNote={m.movement_type === "ASSET_SALE" ? "ลบเฉพาะเงินขายที่เข้าบัญชี — สถานะ / มูลค่าราคาขาย ต้องแก้เองด้านล่าง" : undefined}
                fields={[{ name: "movement_date", label: "วันที่", type: "date", value: m.movement_date }, { name: "amount", label: "จำนวน", type: "number", value: m.amount },
                  { name: "description", label: "รายละเอียด", value: m.description, width: "w-40" }]} />}</td>
            </tr>
          ))}
        </tbody></table>
      )}
      {sold && <p className="mt-2 text-xs text-slate-500">บันทึกขายผิด: ลบ &ldquo;เงินขาย&rdquo; ด้านบน ลบมูลค่า &ldquo;ราคาขาย&rdquo; ในประวัติมูลค่า แล้วเปลี่ยนสถานะกลับเป็น &ldquo;ถืออยู่&rdquo;</p>}
    </section>
  );
}
