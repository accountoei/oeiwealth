import { createClient } from "@/lib/supabase/server";
import { money, thDate } from "@/lib/format";
import RowActions from "@/components/RowActions";
import UndoButton from "@/components/UndoButton";

/** รายการจ่ายซื้อ / ขาย ของทรัพย์สิน + สรุปกำไรขาดทุนเมื่อขายแล้ว */
export default async function AssetTradeHistory({ assetId, currency, status, cost, paths, canWrite, canDelete, showMoves = true }: {
  assetId: string; currency: string; status: string; cost: number | null; paths: string[];
  canWrite: boolean; canDelete: boolean; showMoves?: boolean;
}) {
  const supabase = await createClient();
  const [{ data: moves }, { data: saleVal }, { data: lastVal }, { data: parts }] = await Promise.all([
    supabase.from("cash_movements").select("id,movement_date,movement_type,amount,fee,currency,description,metadata")
      .or(`from_asset_id.eq.${assetId},to_asset_id.eq.${assetId}`).in("movement_type", ["ASSET_PURCHASE", "ASSET_SALE"])
      .is("deleted_at", null).order("movement_date", { ascending: false }),
    supabase.from("asset_valuations").select("valuation_date,value").eq("asset_id", assetId).eq("notes", "ราคาขาย")
      .is("deleted_at", null).order("valuation_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("asset_valuations").select("valuation_date,value").eq("asset_id", assetId).or("notes.is.null,notes.neq.ราคาขาย")
      .is("deleted_at", null).order("valuation_date", { ascending: false }).limit(1).maybeSingle(),
    // ขายบางส่วน (Alternative) · ใหม่สุดก่อน
    supabase.from("alternative_part_sales").select("id,sale_date,quantity,quantity_before,price,fee,book_value,gain,created_at")
      .eq("asset_id", assetId).is("deleted_at", null).order("sale_date", { ascending: false }).order("created_at", { ascending: false }),
  ]);
  const list = moves ?? [];
  const partList = parts ?? [];
  const isPart = (m: { metadata: unknown }) => !!(m.metadata as { part_sale?: boolean } | null)?.part_sale;
  const sale = list.find((m) => m.movement_type === "ASSET_SALE" && !isPart(m));
  const meta = (sale?.metadata ?? {}) as { sale_price?: number; fee?: number; book_value?: number | null; gain?: number | null };
  const price = meta.sale_price != null ? Number(meta.sale_price) : saleVal ? Number(saleVal.value) : null;
  const fee = Number(meta.fee ?? 0);
  const paid = list.filter((m) => m.movement_type === "ASSET_PURCHASE").reduce((s, m) => s + Number(m.amount), 0);
  const basis = cost ?? (paid > 0 ? paid : null);
  const sold = status === "SOLD" && price != null;
  if (!sold && partList.length === 0 && (!showMoves || list.length === 0)) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 font-medium text-slate-900">ซื้อ / ขาย</h2>
      {sold && (
        <div className="mb-4 grid gap-3 rounded-lg bg-slate-50 p-4 text-sm md:grid-cols-4">
          <div><div className="text-xs text-slate-500">ราคาขาย {saleVal && `(${thDate(saleVal.valuation_date)})`}</div><div className="font-medium tabular-nums">{money(price, currency, 0)}</div></div>
          <div><div className="text-xs text-slate-500">ค่าใช้จ่ายในการขาย</div><div className="tabular-nums">{money(fee, currency, 0)}</div></div>
          <div><div className="text-xs text-slate-500">ต้นทุน (ราคาที่ได้มา)</div><div className="tabular-nums">{basis != null ? money(basis, currency, 0) : "ยังไม่ได้ระบุ"}</div></div>
          <div>
            <div className="text-xs text-slate-500">เทียบต้นทุน (ดูเป็นข้อมูล)</div>
            {basis != null ? (() => { const g = (price ?? 0) - fee - basis; return (
              <div className={`font-semibold tabular-nums ${g >= 0 ? "text-emerald-700" : "text-red-600"}`}>{g >= 0 ? "+" : ""}{money(g, currency, 0)}</div>); })()
              : <div className="text-xs text-amber-700">ใส่ &ldquo;ราคาที่ได้มา&rdquo; เพื่อคำนวณ</div>}
          </div>
          {meta.gain != null ? (
            <div className="text-sm md:col-span-4">
              กำไร / ขาดทุนที่ลงบัญชี (เทียบมูลค่าล่าสุด {money(meta.book_value, currency, 0)}):{" "}
              <b className={Number(meta.gain) >= 0 ? "text-emerald-700" : "text-red-600"}>{Number(meta.gain) >= 0 ? "+" : ""}{money(meta.gain, currency, 0)}</b>
              <span className="text-xs text-slate-500"> · ลงเป็น{Number(meta.gain) >= 0 ? "รายได้" : "ค่าใช้จ่าย"}ของเจ้าของตามสัดส่วน</span>
            </div>
          ) : lastVal && <div className="text-xs text-slate-500 md:col-span-4">
            เทียบมูลค่าล่าสุดก่อนขาย {money(lastVal.value, currency, 0)} ({thDate(lastVal.valuation_date)}) → ส่วนต่าง {money((price ?? 0) - Number(lastVal.value), currency, 0)}
          </div>}
        </div>
      )}
      {partList.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-1 text-sm font-medium text-slate-800">ขายบางส่วน</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">วันที่</th><th className="text-right">จำนวนที่ขาย</th>
              <th className="text-right">ราคาขาย</th><th className="text-right">มูลค่าส่วนที่ขาย</th><th className="text-right">กำไร / ขาดทุน</th><th></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {partList.map((x, i) => (
                <tr key={x.id}>
                  <td className="py-1.5">{thDate(x.sale_date)}</td>
                  <td className="text-right tabular-nums">{Number(x.quantity).toLocaleString("en-US", { maximumFractionDigits: 8 })}
                    <span className="block text-xs text-slate-400">จาก {Number(x.quantity_before).toLocaleString("en-US", { maximumFractionDigits: 8 })}</span></td>
                  <td className="text-right tabular-nums">{money(x.price, currency, 0)}{Number(x.fee) > 0 && <span className="block text-xs text-slate-400">ค่าใช้จ่าย {money(x.fee, currency, 0)}</span>}</td>
                  <td className="text-right tabular-nums">{x.book_value != null ? money(x.book_value, currency, 0) : "-"}</td>
                  <td className={`text-right tabular-nums ${Number(x.gain) >= 0 ? "text-emerald-700" : "text-red-600"}`}>{Number(x.gain) >= 0 ? "+" : ""}{money(x.gain, currency, 0)}</td>
                  <td className="pl-2 text-right">{canDelete && i === 0 && status === "ACTIVE" &&
                    <UndoButton kind="ALT_PART_SALE" id={x.id} paths={paths} label="ยกเลิก"
                      confirmText={`ยกเลิกการขายบางส่วนวันที่ ${thDate(x.sale_date)}?\nจำนวน / มูลค่า / ราคาทุนกลับเป็นก่อนขาย · เงินเข้าบัญชีและกำไร / ขาดทุนของครั้งนี้ถูกลบพร้อมกัน`} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-500">กำไร / ขาดทุน = เงินขายสุทธิ − มูลค่าส่วนที่ขาย (เทียบมูลค่าล่าสุด) → ลงเป็นรายได้ / ค่าใช้จ่ายของเจ้าของตามสัดส่วน · ยกเลิกได้เฉพาะครั้งล่าสุด</p>
        </div>
      )}
      {showMoves && list.length > 0 && (
        <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
          {list.map((m) => (
            <tr key={m.id}>
              <td className="py-1.5">{thDate(m.movement_date)}</td>
              <td>{m.movement_type === "ASSET_SALE" ? `${isPart(m) ? "ขายบางส่วน · " : ""}${(m.metadata as { gain?: number } | null)?.gain != null ? "เงินขาย (ทุนคืน) เข้าบัญชี" : "เงินขาย (สุทธิ) เข้าบัญชี"}` : "จ่ายซื้อ / จ่ายเพิ่ม"}</td>
              <td className="text-slate-500">{m.description}</td>
              <td className={`text-right tabular-nums ${m.movement_type === "ASSET_SALE" ? "text-emerald-700" : ""}`}>{money(m.amount, m.currency)}</td>
              <td className="pl-2 text-right">{canWrite && <RowActions table="cash_movements" id={m.id} paths={paths} canDelete={canDelete && !isPart(m)} canEdit={m.movement_type === "ASSET_PURCHASE"}
                deleteNote={m.movement_type === "ASSET_SALE" ? "ลบเฉพาะเงินขายที่เข้าบัญชี — สถานะ / มูลค่าราคาขาย ต้องแก้เองด้านล่าง" : undefined}
                fields={[{ name: "movement_date", label: "วันที่", type: "date", value: m.movement_date }, { name: "amount", label: "จำนวน", type: "number", value: m.amount },
                  { name: "description", label: "รายละเอียด", value: m.description, width: "w-40" }]} />}</td>
            </tr>
          ))}
        </tbody></table>
      )}
      {sold && <p className="mt-2 text-xs text-slate-500">บันทึกขายผิด: ลบ &ldquo;เงินขาย&rdquo; ด้านบน ลบรายได้กำไร / ค่าใช้จ่ายขาดทุนจากการขายในหน้ารายได้ / ค่าใช้จ่าย ลบมูลค่า &ldquo;ราคาขาย&rdquo; ในประวัติมูลค่า แล้วเปลี่ยนสถานะกลับเป็น &ldquo;ถืออยู่&rdquo;</p>}
    </section>
  );
}
