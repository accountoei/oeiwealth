/**
 * ตัวเลือกบัญชีเงินฝากใน <select> · บัญชีที่ใช้บ่อย (frequent จาก v_bank_accounts_safe) อยู่กลุ่ม "ใช้บ่อย" บนสุด (ตกลง 3 พ.ย. 2026)
 * รายการต้องเรียงมาแล้วตาม pick_order (ใช้บ่อยก่อน → ลำดับที่จัดไว้ → ชื่อ) · ไม่มีบัญชีใช้บ่อย = แสดงเรียงปกติไม่มีหัวกลุ่ม
 */
type Bank = { asset_id: string; name: string; currency?: string | null; frequent?: boolean | null };

export default function BankOptions({ banks, ccy = false }: { banks: Bank[]; ccy?: boolean }) {
  const opt = (b: Bank) => <option key={b.asset_id} value={b.asset_id}>{b.name}{ccy && b.currency ? ` (${b.currency})` : ""}</option>;
  const top = banks.filter((b) => b.frequent);
  if (!top.length || top.length === banks.length) return <>{banks.map(opt)}</>;
  return (
    <>
      <optgroup label="ใช้บ่อย">{top.map(opt)}</optgroup>
      <optgroup label="บัญชีอื่น">{banks.filter((b) => !b.frequent).map(opt)}</optgroup>
    </>
  );
}
