/**
 * บัญชีรับดอกเบี้ย / ปันผล / เงินคืน ของหลักทรัพย์ (ตกลง 24 ต.ค. 2026): "h:<id>" บัญชีเงินฝากในพอร์ต · "a:<id>" บัญชีธนาคาร
 *   (รูปแบบเดียวกับ money-endpoint) · ค่าตั้งต้น = บัญชีที่ผูกไว้ (ถ้ายังอยู่ในรายการ) → บัญชีหลักในพอร์ต ★ → บัญชีธนาคารแรก
 *   ใช้ได้ทั้งฝั่ง server / client
 */
type Cash = { id: string; name: string; currency: string; is_default_cash: boolean };
type Bank = { asset_id: string; name: string; currency: string };

/** [ค่า, ชื่อบัญชี, กลุ่ม] — กลุ่มแสดงเป็นหัวกลุ่ม (optgroup) แทนคำนำหน้าชื่อ ช่องที่ปิดอยู่จึงเห็นชื่อบัญชีเต็มกว่า (28 ต.ค. 2026) */
export type IncomeOpt = [string, string, string];
export const INCOME_GROUP = { portfolio: "เงินฝากในพอร์ต", bank: "บัญชีธนาคาร" } as const;

export function incomeAccountOptions(cashAccounts: Cash[], banks: Bank[], currency: string): IncomeOpt[] {
  return [
    ...cashAccounts.filter((a) => a.currency === currency).sort((a, b) => Number(b.is_default_cash) - Number(a.is_default_cash))
      .map((a): IncomeOpt => [`h:${a.id}`, `${a.name}${a.is_default_cash ? " ★" : ""}`, INCOME_GROUP.portfolio]),
    ...banks.filter((b) => b.currency === currency).map((b): IncomeOpt => [`a:${b.asset_id}`, b.name, INCOME_GROUP.bank]),
  ];
}

/** จัดตัวเลือกเป็นกลุ่มตามลำดับเดิม → [หัวกลุ่ม, ตัวเลือก][] */
export function groupIncomeOptions(options: IncomeOpt[]): [string, IncomeOpt[]][] {
  const out: [string, IncomeOpt[]][] = [];
  for (const o of options) {
    const last = out[out.length - 1];
    if (last && last[0] === o[2]) last[1].push(o); else out.push([o[2], [o]]);
  }
  return out;
}

export function defaultIncomeAccount(options: IncomeOpt[], cashId?: string | null, bankId?: string | null) {
  const has = (v: string) => options.some(([o]) => o === v);
  if (cashId && has(`h:${cashId}`)) return `h:${cashId}`;
  if (bankId && has(`a:${bankId}`)) return `a:${bankId}`;
  return options[0]?.[0] ?? "";
}
