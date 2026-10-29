import { createClient } from "@/lib/supabase/server";
import { money, thDate } from "@/lib/format";
import RowActions from "@/components/RowActions";
import UndoButton from "@/components/UndoButton";
import HistoryRows, { type HistoryRow } from "@/components/HistoryRows";
import ModalButton from "@/components/ModalButton";
import type { ReactNode } from "react";

export type ValRow = { id: string; valuation_date: string; value: number; source: string; notes: string | null; valuation_method?: string | null;
  /** Property: รายละเอียดแยกตามโฉนด / อาคาร (ข้อความสรุป) */ detail?: string | null;
  /** มูลค่าที่ระบบเพิ่มจากรายการจ่าย (ติ๊ก "เพิ่มมูลค่า") */ source_movement_id?: string | null };

/** รายการจ่ายซื้อ / ขาย ของทรัพย์สิน + สรุปกำไรขาดทุนเมื่อขายแล้ว
 *  ส่ง valuations มาด้วย (Property / Alternative / Business) → ปุ่มสำหรับวางในกล่องมูลค่าล่าสุด (ตกลง 27 ต.ค. 2026):
 *  "อัปเดตมูลค่า" (pop up ฟอร์ม) + "ประวัติ…" (pop up ตารางเดียวเรียงตามวันที่: จ่ายซื้อ / เงินขาย / มูลค่า + สรุปการขาย)
 *  ราคาทองอัตโนมัติรายวันซ่อนไว้ก่อน */
export default async function AssetTradeHistory({ assetId, currency, status, cost, paths, canWrite, canDelete, showMoves = true,
  valuations, valuationForm, valuationHint, sourceLabel = {}, methodLabel, perUnit, perUnitDigits, unit, paymentEditor, extra, singleLabel, flow, deletableValuation }: {
  assetId: string; currency: string; status: string; cost: number | null; paths: string[];
  canWrite: boolean; canDelete: boolean; showMoves?: boolean;
  valuations?: ValRow[]; valuationForm?: ReactNode; valuationHint?: string; sourceLabel?: Record<string, string>;
  methodLabel?: Record<string, string>; perUnit?: (v: number, date: string) => number | null; unit?: string | null; perUnitDigits?: number;
  /** Property: ฟอร์มแก้รายการจ่ายซื้อ / จ่ายเพิ่ม (ติ๊กอาคารได้) แทนฟอร์มกลาง */
  paymentEditor?: (m: { id: string; movement_date: string; amount: number; description: string | null; add_value: boolean; component_id: string | null }) => ReactNode;
  /** Property: ส่วนต่อท้ายในหน้าต่างเดียวกัน (ต้นทุนรายก้อน + เพิ่มต้นทุน) */ extra?: ReactNode;
  /** มีค่า = ปุ่มเดียว (อัปเดตมูลค่า + ประวัติ + extra ในหน้าต่างเดียว · ตกลง 28 ต.ค. 2026) */ singleLabel?: string;
  /** Property: ตารางประวัติแยกคอลัมน์ "เงินจ่าย / รับ" กับ "มูลค่าเปลี่ยน" + มูลค่าหลังรายการ · รายการจ่ายที่เพิ่มมูลค่าอยู่บรรทัดเดียว (ตกลง 29 ต.ค. 2026)
   *  ค่า = ชื่อส่วนประกอบ (id → ชื่อ) ของรายการจ่าย */ flow?: Record<string, string>;
  /** flow: มูลค่าแก้ไม่ได้ · ลบได้เฉพาะ id นี้ (ครั้งล่าสุดที่บันทึกเอง · ตกลง 29 ต.ค. 2026) */ deletableValuation?: string | null;
}) {
  const supabase = await createClient();
  const [{ data: moves }, { data: saleVal }, { data: lastVal }, { data: parts }] = await Promise.all([
    supabase.from("cash_movements").select("id,movement_date,movement_type,amount,fee,currency,description,metadata,from_credit_card_id")
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
  const merged = valuations != null;
  if (!merged && !sold && partList.length === 0 && (!showMoves || list.length === 0)) return null;

  const moveLabel = (m: (typeof list)[number]) => m.movement_type === "ASSET_SALE"
    ? `${isPart(m) ? "ขายบางส่วน · " : ""}${(m.metadata as { gain?: number } | null)?.gain != null ? "เงินขาย (ทุนคืน) เข้าบัญชี" : "เงินขาย (สุทธิ) เข้าบัญชี"}`
    : `จ่ายซื้อ / จ่ายเพิ่ม${m.from_credit_card_id ? " (บัตรเครดิต)" : (m.metadata as { paid_via?: string } | null)?.paid_via === "cash" ? " (เงินสด)" : ""}`;
  const moveActions = (m: (typeof list)[number]) => canWrite && <RowActions table="cash_movements" id={m.id} paths={paths} canDelete={canDelete && !isPart(m)} canEdit={m.movement_type === "ASSET_PURCHASE"}
    editor={paymentEditor && m.movement_type === "ASSET_PURCHASE"
      ? paymentEditor({ id: m.id, movement_date: m.movement_date, amount: Number(m.amount), description: m.description,
        add_value: (m.metadata as { add_value?: boolean } | null)?.add_value === true,
        component_id: (m.metadata as { component_id?: string } | null)?.component_id ?? null }) : undefined}
    deleteNote={m.movement_type === "ASSET_SALE" ? `ลบเฉพาะเงินขายที่เข้าบัญชี — สถานะ / มูลค่าราคาขาย ต้องแก้เอง${merged ? "" : "ด้านล่าง"}` : undefined}
    fields={[{ name: "movement_date", label: "วันที่", type: "date", value: m.movement_date }, { name: "amount", label: "จำนวน", type: "number", value: m.amount },
      { name: "description", label: "รายละเอียด", value: m.description, width: "w-40" }]} />;

  const summary = (
    <>
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
    </>
  );

  if (merged) {
    const showPer = !!perUnit && valuations.some((v) => perUnit(Number(v.value), v.valuation_date) != null);
    type Item = { key: string; date: string; order: number; auto: boolean; row: ReactNode };
    // Property: เงินจริง (จ่าย / รับ) กับมูลค่า (เปลี่ยนเท่าไร · หลังรายการเท่าไร) แยกคอลัมน์ · มูลค่าที่เพิ่มจากรายการจ่ายอยู่บรรทัดเดียวกับรายการจ่าย
    const flowRows = (): HistoryRow[] => {
      // valuations มาแบบ ใหม่ → เก่า (วันที่ แล้วเวลาที่บันทึก) · กลับลำดับแล้วเรียงตามวันที่ (วันเดียวกันคงลำดับที่บันทึก)
      const asc = [...valuations].reverse().sort((a, b) => (a.valuation_date < b.valuation_date ? -1 : a.valuation_date > b.valuation_date ? 1 : 0));
      const delta = new Map<string, number | null>(asc.map((v, i) => [v.id, i === 0 ? null : Number(v.value) - Number(asc[i - 1].value)]));
      const byMove = new Map(valuations.filter((v) => v.source_movement_id).map((v) => [v.source_movement_id!, v]));
      const change = (v: ValRow | undefined) => {
        if (!v) return <td></td>;
        const d = delta.get(v.id);
        return <td className={`text-right tabular-nums ${d == null ? "text-slate-400" : d >= 0 ? "text-emerald-700" : "text-red-600"}`}>
          {d == null ? "ตั้งต้น" : `${d >= 0 ? "+" : "−"}${money(Math.abs(d), undefined, 0)}`}</td>;
      };
      const out: Item[] = [
        ...(showMoves ? list : []).map((m): Item => {
          const v = byMove.get(m.id);
          const comp = (m.metadata as { component_id?: string } | null)?.component_id;
          const sale = m.movement_type === "ASSET_SALE";
          return { key: `m${m.id}`, date: m.movement_date, order: 0, auto: false, row: (
            <tr className="align-top">
              <td className="py-1.5 whitespace-nowrap">{thDate(m.movement_date)}</td>
              <td>{sale ? moveLabel(m) : "จ่ายซื้อ / จ่ายเพิ่ม"}{v && <span className="block text-xs text-slate-400">เพิ่มมูลค่าตามยอดจ่าย</span>}</td>
              <td className="text-slate-500">{m.description}{comp && flow?.[comp] && <span className="block text-xs text-slate-400">{flow[comp]}</span>}</td>
              <td className={`text-right tabular-nums ${sale ? "text-emerald-700" : ""}`}>{sale ? "รับ " : "จ่าย "}{money(m.amount, undefined, 0)}</td>
              {change(v)}
              <td className="text-right tabular-nums">{v ? money(v.value, undefined, 0) : ""}</td>
              <td className="pl-2 text-right">{moveActions(m)}</td>
            </tr>) };
        }),
        ...valuations.filter((v) => !(v.source_movement_id && list.some((m) => m.id === v.source_movement_id))).map((v): Item => ({
          key: `v${v.id}`, date: v.valuation_date, order: 1, auto: v.source === "MARKET", row: (
          <tr className="align-top">
            <td className="py-1.5 whitespace-nowrap">{thDate(v.valuation_date)}</td>
            <td>{v.notes === "ราคาขาย" ? "มูลค่า (ราคาขาย)" : "ปรับมูลค่า"}
              <span className="block text-xs text-slate-400">{[v.valuation_method ? methodLabel?.[v.valuation_method] ?? v.valuation_method : null,
                sourceLabel[v.source] ?? v.source].filter(Boolean).join(" · ")}</span></td>
            <td className="text-slate-500">{v.notes === "ราคาขาย" ? "" : v.notes}{v.detail && <span className="block text-xs text-slate-400">{v.detail}</span>}</td>
            <td className="text-right text-slate-400">-</td>
            {change(v)}
            <td className="text-right tabular-nums">{money(v.value, undefined, 0)}</td>
            <td className="pl-2 text-right">
              {canDelete && v.id === deletableValuation && <RowActions table="asset_valuations" id={v.id} paths={paths} canDelete canEdit={false} fields={[]} />}
            </td>
          </tr>) })),
      ];
      out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.order - a.order));
      return out.map(({ key, auto, row }) => ({ key, auto, row }));
    };
    const items: Item[] = [
      ...(showMoves ? list : []).map((m): Item => ({ key: `m${m.id}`, date: m.movement_date, order: 0, auto: false, row: (
        <tr>
          <td className="py-1.5">{thDate(m.movement_date)}</td>
          <td>{moveLabel(m)}</td>
          <td className="text-slate-500">{m.description}</td>
          <td className={`text-right tabular-nums ${m.movement_type === "ASSET_SALE" ? "text-emerald-700" : ""}`}>{money(m.amount, m.currency)}</td>
          {showPer && <td></td>}
          <td className="pl-2 text-right">{moveActions(m)}</td>
        </tr>) })),
      ...valuations.map((v): Item => ({ key: `v${v.id}`, date: v.valuation_date, order: 1, auto: v.source === "MARKET", row: (
        <tr>
          <td className="py-1.5">{thDate(v.valuation_date)}</td>
          <td>มูลค่า{v.notes === "ราคาขาย" ? " (ราคาขาย)" : ""}
            <span className="block text-xs text-slate-400">{[v.valuation_method ? methodLabel?.[v.valuation_method] ?? v.valuation_method : null,
              sourceLabel[v.source] ?? v.source].filter(Boolean).join(" · ")}</span></td>
          <td className="text-slate-500">{v.notes === "ราคาขาย" ? "" : v.notes}{v.detail && <span className="block text-xs text-slate-400">{v.detail}</span>}</td>
          <td className="text-right tabular-nums">{money(v.value, undefined, 0)}</td>
          {showPer && <td className="text-right tabular-nums text-slate-500">{perUnit && perUnit(Number(v.value), v.valuation_date) != null ? money(perUnit(Number(v.value), v.valuation_date), undefined, perUnitDigits) : ""}</td>}
          <td className="pl-2 text-right">
            {canWrite && <RowActions table="asset_valuations" id={v.id} paths={paths} canDelete={canDelete && valuations.length > 1}
              fields={[{ name: "valuation_date", label: "วันที่", type: "date", value: v.valuation_date }, { name: "value", label: "มูลค่า", type: "number", value: v.value },
                { name: "notes", label: "หมายเหตุ", value: v.notes, width: "w-40" }]} />}
          </td>
        </tr>) })),
    ];
    // ใหม่ → เก่า · วันเดียวกัน: มูลค่าก่อนรายการเงิน (มูลค่าหลังซื้อ / ขายอยู่บนสุด)
    items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.order - a.order));
    const rows: HistoryRow[] = flow ? flowRows() : items.map(({ key, auto, row }) => ({ key, auto, row }));
    const historyLabel = sold || partList.length > 0 ? "ประวัติซื้อ / ขาย / มูลค่า" : list.length > 0 ? "ประวัติซื้อ / มูลค่า" : "ประวัติมูลค่า";
    const history = (
      <HistoryRows title={null} rows={rows}
        head={flow ? <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">วันที่</th><th>รายการ</th><th>รายละเอียด / ส่วนประกอบ</th>
          <th className="text-right">เงินจ่าย / รับ</th><th className="text-right">มูลค่าเปลี่ยน</th><th className="text-right">มูลค่าหลังรายการ</th><th></th></tr></thead>
          : <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">วันที่</th><th>รายการ</th><th>รายละเอียด / หมายเหตุ</th>
          <th className="text-right">จำนวนเงิน / มูลค่า</th>{showPer && <th className="text-right">ต่อ{unit ?? "หน่วย"}</th>}<th></th></tr></thead>}>
        {summary}
        {sold && <p className="mb-3 text-xs text-slate-500">บันทึกขายผิด: ลบ &ldquo;เงินขาย&rdquo; ในตาราง ลบรายได้กำไร / ค่าใช้จ่ายขาดทุนจากการขายในหน้ารายได้ / ค่าใช้จ่าย ลบมูลค่า &ldquo;ราคาขาย&rdquo; แล้วเปลี่ยนสถานะกลับเป็น &ldquo;ถืออยู่&rdquo;</p>}
      </HistoryRows>
    );
    // Property: ปุ่มเดียว "ปรับมูลค่า / ประวัติ" = อัปเดตมูลค่า + ประวัติ + ต้นทุนรายก้อน (ตกลง 28 ต.ค. 2026)
    if (singleLabel) return (
      <div className="mt-3 flex flex-wrap gap-2">
        <ModalButton label={singleLabel} title={singleLabel} size="lg" primary>
          <div className="space-y-5">
            {valuationForm && (
              <div>
                <h3 className="mb-1 text-sm font-medium text-slate-800">อัปเดตมูลค่า (นับใน Net Worth)</h3>
                {valuationHint && <p className="mb-2 text-xs text-slate-500">{valuationHint}</p>}
                {valuationForm}
              </div>
            )}
            <div className="border-t border-slate-100 pt-3">
              <h3 className="mb-1 text-sm font-medium text-slate-800">{historyLabel}</h3>
              {history}
            </div>
            {extra}
          </div>
        </ModalButton>
      </div>
    );
    // ปุ่มในกล่องมูลค่าล่าสุด (แทนกล่อง "ซื้อ / ขาย และมูลค่า" · ตกลง 27 ต.ค. 2026)
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {valuationForm && (
          <ModalButton label="อัปเดตมูลค่า" title="อัปเดตมูลค่า" primary>
            {valuationHint && <p className="mb-3 text-xs text-slate-500">{valuationHint}</p>}
            {valuationForm}
          </ModalButton>
        )}
        <ModalButton label={`${historyLabel} (${rows.filter((r) => !r.auto).length})`} title={historyLabel} size="lg">{history}</ModalButton>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 font-medium text-slate-900">ซื้อ / ขาย</h2>
      {summary}
      {showMoves && list.length > 0 && (
        <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
          {list.map((m) => (
            <tr key={m.id}>
              <td className="py-1.5">{thDate(m.movement_date)}</td>
              <td>{moveLabel(m)}</td>
              <td className="text-slate-500">{m.description}</td>
              <td className={`text-right tabular-nums ${m.movement_type === "ASSET_SALE" ? "text-emerald-700" : ""}`}>{money(m.amount, m.currency)}</td>
              <td className="pl-2 text-right">{moveActions(m)}</td>
            </tr>
          ))}
        </tbody></table>
      )}
      {sold && <p className="mt-2 text-xs text-slate-500">บันทึกขายผิด: ลบ &ldquo;เงินขาย&rdquo; ด้านบน ลบรายได้กำไร / ค่าใช้จ่ายขาดทุนจากการขายในหน้ารายได้ / ค่าใช้จ่าย ลบมูลค่า &ldquo;ราคาขาย&rdquo; ในประวัติมูลค่า แล้วเปลี่ยนสถานะกลับเป็น &ldquo;ถืออยู่&rdquo;</p>}
    </section>
  );
}
