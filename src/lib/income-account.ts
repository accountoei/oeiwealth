/**
 * บัญชีรับดอกเบี้ย / ปันผล / เงินคืน ของหลักทรัพย์ (ตกลง 24 ต.ค. 2026): "h:<id>" บัญชีเงินฝากในพอร์ต · "a:<id>" บัญชีธนาคาร
 *   (รูปแบบเดียวกับ money-endpoint) · ค่าตั้งต้น = บัญชีที่ผูกไว้ (ถ้ายังอยู่ในรายการ) → บัญชีหลักในพอร์ต ★ → บัญชีธนาคารแรก
 *   ใช้ได้ทั้งฝั่ง server / client
 */
type Cash = { id: string; name: string; currency: string; is_default_cash: boolean };
type Bank = { asset_id: string; name: string; currency: string };

export function incomeAccountOptions(cashAccounts: Cash[], banks: Bank[], currency: string): [string, string][] {
  return [
    ...cashAccounts.filter((a) => a.currency === currency).sort((a, b) => Number(b.is_default_cash) - Number(a.is_default_cash))
      .map((a) => [`h:${a.id}`, `ในพอร์ต · ${a.name}${a.is_default_cash ? " ★" : ""}`] as [string, string]),
    ...banks.filter((b) => b.currency === currency).map((b) => [`a:${b.asset_id}`, `ธนาคาร · ${b.name}`] as [string, string]),
  ];
}

export function defaultIncomeAccount(options: [string, string][], cashId?: string | null, bankId?: string | null) {
  const has = (v: string) => options.some(([o]) => o === v);
  if (cashId && has(`h:${cashId}`)) return `h:${cashId}`;
  if (bankId && has(`a:${bankId}`)) return `a:${bankId}`;
  return options[0]?.[0] ?? "";
}
