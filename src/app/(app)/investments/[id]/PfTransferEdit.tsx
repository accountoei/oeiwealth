import RowActions from "@/components/RowActions";
import PfTransferEditor from "../../income-expenses/PfTransferEditor";
import type { CashAcct, PfTransfer } from "./forms";

/**
 * แก้ / ลบ การโอน ธนาคาร ↔ พอร์ต ในหน้าพอร์ต และหน้าบัญชีเงินฝากในพอร์ต
 *   ฟอร์มเดียวกับหน้า Income & Expenses · ปุ่มลบอยู่ข้างปุ่มบันทึก (ตกลง 10 พ.ย. 2026)
 *   ในตาราง = กดที่แถว · ใส่ button (เช่น กล่อง "รอยอดปลายทาง") = ปุ่มสีส้ม
 */
export default function PfTransferEdit({ m, portfolioId, portfolioLabel, bankLabel, cashAccounts, paths, canDelete, button }: {
  m: PfTransfer; portfolioId: string; portfolioLabel: string; bankLabel: string; cashAccounts: CashAcct[];
  paths: string[]; canDelete: boolean; button?: string;
}) {
  return (
    <RowActions table="cash_movements" id={m.id} paths={paths} canDelete={canDelete} button={button}
      buttonClass={button ? "rounded-md bg-amber-600 px-2.5 py-1 text-xs text-white hover:bg-amber-700" : undefined}
      deleteNote="รายการฝาก/ถอนในพอร์ต และค่าธรรมเนียมโอน จะถูกลบตาม"
      editor={<PfTransferEditor id={m.id} portfolioId={portfolioId} portfolioLabel={portfolioLabel} bankLabel={bankLabel}
        bankId={(m.movement_type === "INVESTMENT_OUT" ? m.from_asset_id : m.to_asset_id) ?? ""}
        accounts={cashAccounts.map((c) => ({ id: c.id, label: c.name, currency: c.currency }))}
        values={{ type: m.movement_type, date: m.movement_date, amount: Number(m.amount), currency: m.currency,
          fee: m.fee == null ? null : Number(m.fee), counterAmount: m.counter_amount == null ? null : Number(m.counter_amount),
          counterCurrency: m.counter_currency, counterFee: m.counter_fee == null ? null : Number(m.counter_fee),
          cashHoldingId: m.cash_holding_id, description: m.description }} />} />
  );
}
