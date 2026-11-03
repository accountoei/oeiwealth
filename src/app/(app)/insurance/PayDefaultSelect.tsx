/**
 * "จ่ายเบี้ยจาก (ค่าตั้งต้น)" ของกรมธรรม์ (ตกลง 3 พ.ย. 2026 · แบบค่าใช้จ่ายประจำของทรัพย์สิน)
 *   ค่า: "a:<บัญชี>" / "c:<บัตร>" / ว่าง = เลือกตอนจ่าย · ใช้เป็นค่าตั้งต้นของแท็บจ่ายชำระเบี้ยและปุ่มจ่ายในหน้ากรมธรรม์
 *   currency ระบุ = แสดงเฉพาะบัญชี / บัตรสกุลนั้น · ไม่ระบุ = แสดงทั้งหมด (ต่อท้ายสกุลที่ไม่ใช่ THB) · ฐานข้อมูลตรวจสกุลอีกชั้น
 */
type Bank = { asset_id: string; name: string; currency: string; frequent?: boolean | null };
type Card = { id: string; label: string; currency: string };

export default function PayDefaultSelect({ banks, cards, value = "", currency, className }: {
  banks: Bank[]; cards: Card[]; value?: string; currency?: string; className?: string;
}) {
  const bs = currency ? banks.filter((b) => b.currency === currency) : banks;
  const cs = currency ? cards.filter((c) => c.currency === currency) : cards;
  const ccy = (c: string) => (!currency && c !== "THB" ? ` (${c})` : "");
  return (
    <select name="pay_default" defaultValue={value} className={className}>
      <option value="">— ไม่ระบุ (เลือกตอนจ่าย) —</option>
      {bs.length > 0 && <optgroup label="บัญชีธนาคาร">{bs.map((b) => <option key={b.asset_id} value={`a:${b.asset_id}`}>{b.name}{ccy(b.currency)}</option>)}</optgroup>}
      {cs.length > 0 && <optgroup label="บัตรเครดิต">{cs.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.label}{ccy(c.currency)}</option>)}</optgroup>}
    </select>
  );
}

/** ค่าในช่องเลือกจากคอลัมน์ paid_from_asset_id / paid_from_credit_card_id ของกรมธรรม์ */
export const payDefaultValue = (p: { paid_from_asset_id?: string | null; paid_from_credit_card_id?: string | null }) =>
  p.paid_from_asset_id ? `a:${p.paid_from_asset_id}` : p.paid_from_credit_card_id ? `c:${p.paid_from_credit_card_id}` : "";
