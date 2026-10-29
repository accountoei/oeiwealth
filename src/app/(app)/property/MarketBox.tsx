import RowActions from "@/components/RowActions";
import ModalButton from "@/components/ModalButton";
import MarketValuationForm, { type MarketValuation } from "./MarketValuationForm";
import {
  MARKET_CONFIDENCE_LABEL, MARKET_METHOD_LABEL, MARKET_PRICE_TYPE_LABEL, MARKET_UNIT_LABEL, diffText, marketDefaultUnit, marketStale, money, thDate,
} from "@/lib/format";

/**
 * ราคาตลาด (อ้างอิง · ไม่นับใน Net Worth · ตกลง 28 ต.ค. 2026) — อยู่ในกล่องมูลค่าล่าสุดของหน้าทรัพย์สิน
 *   ครั้งล่าสุด = วันที่ประเมินใหม่ที่สุด · เทียบราคาขายขั้นต่ำที่คุ้ม (ไม่มี → เทียบมูลค่าใน Net Worth · ตกลง 29 ต.ค. 2026) · ถ้าขายได้สุทธิ ก่อน / หลังปิดหนี้
 */
export default function MarketBox({ assetId, currency, today, propertyType, areaSqWa, nwValue, minPrice, history, debt, canWrite, canDelete, paths }: {
  assetId: string; currency: string; today: string; propertyType: string; areaSqWa: number | null; nwValue: number;
  /** ราคาขายขั้นต่ำที่คุ้ม · null = ยังไม่มีต้นทุน */ minPrice: number | null;
  /** ใหม่ → เก่า */ history: MarketValuation[];
  /** หนี้คงค้างที่ผูกกับทรัพย์สินนี้ (สกุลเดียวกัน) · null = ไม่มี */ debt: number | null;
  canWrite: boolean; canDelete: boolean; paths: string[];
}) {
  const last = history[0] ?? null;
  const form = (edit?: MarketValuation) => (
    <MarketValuationForm assetId={assetId} currency={currency} today={today} defaultUnit={marketDefaultUnit(propertyType)}
      areaSqWa={areaSqWa} last={last} edit={edit} />
  );
  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="text-xs text-slate-500">ราคาตลาด <span className="text-slate-400">(อ้างอิง · ไม่นับใน Net Worth)</span></div>
      {!last ? <p className="mt-1 text-sm text-slate-500">ยังไม่ได้ประเมินราคาตลาด</p> : (<>
        <div className="mt-1 text-xl font-semibold tabular-nums">{money(last.market_value, currency, 0)}</div>
        {(last.value_low != null || last.value_high != null || last.confidence) && (
          <div className="text-xs text-slate-500">
            {(last.value_low != null || last.value_high != null) && `ช่วง ${last.value_low != null ? money(last.value_low, undefined, 0) : "?"} – ${last.value_high != null ? money(last.value_high, undefined, 0) : "?"}`}
            {last.confidence && `${last.value_low != null || last.value_high != null ? " · " : ""}${MARKET_CONFIDENCE_LABEL[last.confidence] ?? last.confidence}`}
          </div>
        )}
        <div className={`text-xs ${marketStale(last.valuation_date, today) ? "text-amber-700" : "text-slate-500"}`}>
          ณ {thDate(last.valuation_date)} · {MARKET_METHOD_LABEL[last.method] ?? last.method}{last.source && ` · ${last.source}`}
          {marketStale(last.valuation_date, today) && " · เกิน 12 เดือน ควรประเมินใหม่"}
        </div>
        {last.unit_basis !== "TOTAL" && last.unit_price != null && (
          <div className="text-xs text-slate-500">{money(last.unit_price, undefined, 0)} / {MARKET_UNIT_LABEL[last.unit_basis]} × {Number(last.area).toLocaleString("en-US")} {MARKET_UNIT_LABEL[last.unit_basis]}</div>
        )}
        <dl className="mt-2 space-y-0.5 text-xs">
          {(() => { const mk = Number(last.market_value), base = minPrice ?? nwValue, ok = mk >= base; return (
            <div className="flex justify-between gap-2"><dt className="text-slate-500">{minPrice != null
              ? (ok ? "สูงกว่าราคาขายขั้นต่ำ → ขายตอนนี้คุ้ม" : "ต่ำกว่าราคาขายขั้นต่ำ → ยังไม่คุ้ม") : "ส่วนต่างจากมูลค่าใน Net Worth"}</dt>
              <dd className={`tabular-nums ${minPrice != null ? "font-medium " : ""}${ok ? "text-emerald-700" : "text-red-600"}`}>{diffText(mk - base, base)}</dd></div>); })()}
          {Number(last.selling_cost) > 0 && (
            <div className="flex justify-between gap-2"><dt className="text-slate-500">ค่าใช้จ่ายขายโดยประมาณ</dt><dd className="tabular-nums">−{money(last.selling_cost)}</dd></div>
          )}
          <div className="flex justify-between gap-2"><dt className="text-slate-500">ถ้าขายได้สุทธิ (ก่อนปิดหนี้)</dt><dd className="tabular-nums font-medium">{money(last.net_before_debt)}</dd></div>
          {debt != null && (<>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">หนี้ที่ผูกกับทรัพย์สินนี้</dt><dd className="tabular-nums">−{money(debt)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">สุทธิหลังปิดหนี้</dt><dd className="tabular-nums font-medium">{money(Number(last.net_before_debt) - debt)}</dd></div>
          </>)}
        </dl>
      </>)}
      <div className="mt-2 flex flex-wrap gap-2">
        {canWrite && <ModalButton label="ประเมินราคาตลาด" title="ประเมินราคาตลาด (อ้างอิง)" size="lg">{form()}</ModalButton>}
        {history.length > 0 && (
          <ModalButton label={`ประวัติราคาตลาด (${history.length})`} title="ประวัติราคาตลาด" size="lg">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr><th className="py-1">วันที่</th><th className="text-right">ราคากลาง</th><th className="text-right">ช่วงราคา</th><th>วิธี / ที่มา</th>
                    <th className="text-right">สุทธิถ้าขาย</th><th></th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.map((h) => (
                    <tr key={h.id} className="align-top">
                      <td className="py-1.5">{thDate(h.valuation_date)}</td>
                      <td className="text-right tabular-nums">{money(h.market_value)}
                        {h.unit_basis !== "TOTAL" && h.unit_price != null && <div className="text-xs text-slate-400">{money(h.unit_price, undefined, 0)} / {MARKET_UNIT_LABEL[h.unit_basis]}</div>}</td>
                      <td className="text-right text-xs tabular-nums">{h.value_low != null || h.value_high != null
                        ? `${h.value_low != null ? money(h.value_low, undefined, 0) : "?"} – ${h.value_high != null ? money(h.value_high, undefined, 0) : "?"}` : "-"}
                        {h.confidence && <div className="text-slate-400">{MARKET_CONFIDENCE_LABEL[h.confidence]}</div>}</td>
                      <td className="text-xs">{MARKET_METHOD_LABEL[h.method] ?? h.method}{h.price_type && ` · ${MARKET_PRICE_TYPE_LABEL[h.price_type]}`}
                        {h.source && <div className="text-slate-400">{h.source}</div>}
                        {h.notes && <div className="text-slate-400">{h.notes}</div>}</td>
                      <td className="text-right tabular-nums">{money(h.net_before_debt)}</td>
                      <td className="pl-2 text-right">
                        {canWrite && <RowActions table="property_market_valuations" id={h.id} paths={paths} canDelete={canDelete} deleteEffect="" editor={form(h)} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ModalButton>
        )}
      </div>
    </div>
  );
}
