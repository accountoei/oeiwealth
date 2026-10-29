// คำนวณภาษีเงินได้บุคคลธรรมดา (แท็บ Tax ส่วนที่ 5) จากรายการในแบบ (tax_return_lines)
//   ยอดที่ใช้: ยอดใช้ยื่น (filed_*) ถ้ากรอก ไม่งั้นยอดจากระบบ · ไม่บันทึกอะไร (ใช้แสดง + เติมผลภาษีตอนบันทึกยื่น)
//   อัตรา / เพดานตามปีภาษีอยู่ใน TAX_RULES · ปีที่ยังไม่มีใช้ของปีล่าสุดก่อนหน้า (แจ้งเตือน)
//   ไฟล์นี้ต้องไม่ import ด้วย "@/…" (ทดสอบด้วย node scripts/tax-calc.test.mjs)

export type TaxLineInput = {
  section: string; code: string; system_amount: number | string | null; qty?: number | string | null;
  filed_amount?: number | string | null; filed_qty?: number | string | null; method?: string | null;
};

type Rules = {
  personal: number; spouse: number; child: number; parent: number; disabled: number;
  lifeIns: number; healthIns: number; lifeHealthCombined: number; parentHealthIns: number;
  pensionPct: number; pensionCap: number; pvdPct: number; pvdCap: number; rmfPct: number; rmfCap: number;
  ssfPct: number; ssfCap: number; retirementCombined: number; thaiEsgPct: number; thaiEsgCap: number;
  socialSecurity: number; homeLoanInt: number; political: number; elderlyExempt: number;
  exp12Pct: number; exp12Cap: number; exp3Pct: number; exp3Cap: number; exp5Pct: number; exp6Pct: number; exp7Pct: number; exp8Pct: number;
  minTaxThreshold: number; minTaxPct: number; minTaxExempt: number;
  brackets: [number, number][];   // [เงินได้สุทธิถึง, อัตรา %] เรียงจากน้อยไปมาก (ขั้นสุดท้าย = Infinity)
};

const BASE: Rules = {
  personal: 60000, spouse: 60000, child: 30000, parent: 30000, disabled: 60000,
  lifeIns: 100000, healthIns: 25000, lifeHealthCombined: 100000, parentHealthIns: 15000,
  pensionPct: 15, pensionCap: 200000, pvdPct: 15, pvdCap: 500000, rmfPct: 30, rmfCap: 500000,
  ssfPct: 30, ssfCap: 200000, retirementCombined: 500000, thaiEsgPct: 30, thaiEsgCap: 100000,
  socialSecurity: 9000, homeLoanInt: 100000, political: 10000, elderlyExempt: 190000,
  exp12Pct: 50, exp12Cap: 100000, exp3Pct: 50, exp3Cap: 100000, exp5Pct: 30, exp6Pct: 30, exp7Pct: 60, exp8Pct: 60,
  minTaxThreshold: 1000000, minTaxPct: 0.5, minTaxExempt: 5000,
  brackets: [[150000, 0], [300000, 5], [500000, 10], [750000, 15], [1000000, 20], [2000000, 25], [5000000, 30], [Infinity, 35]],
};

/** เพดานตามปีภาษี (ค.ศ.) · Thai ESG 300,000 ตั้งแต่ปีภาษี 2568 */
export const TAX_RULES: Record<number, Rules> = {
  2023: BASE,
  2024: BASE,
  2025: { ...BASE, thaiEsgCap: 300000 },
  2026: { ...BASE, thaiEsgCap: 300000 },
};

export type TaxStep = { label: string; amount: number; note?: string; strong?: boolean };
export type TaxCalc = {
  rulesYear: number; warning: string | null;
  assessable: number; expenses: number; deductions: number; donations: number; taxable: number;
  progressive: number; minTax: number; tax: number; credits: number; result: number;
  steps: TaxStep[]; capped: { code: string; label: string; claimed: number; allowed: number; note: string }[];
  brackets: { from: number; to: number; rate: number; base: number; tax: number }[];
};

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const clamp0 = (v: number) => (v > 0 ? v : 0);

/** ภาษีขั้นบันไดจากเงินได้สุทธิ */
export function progressiveTax(taxable: number, brackets = BASE.brackets) {
  const rows: TaxCalc["brackets"] = [];
  let prev = 0, total = 0;
  for (const [to, rate] of brackets) {
    if (taxable <= prev) break;
    const base = Math.min(taxable, to) - prev;
    const tax = r2(base * rate / 100);
    rows.push({ from: prev, to, rate, base: r2(base), tax });
    total += tax;
    prev = to;
  }
  return { tax: r2(total), rows };
}

export function calcTax(lines: TaxLineInput[], year: number, opts: { age?: number | null } = {}): TaxCalc {
  const known = Object.keys(TAX_RULES).map(Number).sort((a, b) => a - b);
  const rulesYear = TAX_RULES[year] ? year : [...known].reverse().find((y) => y < year) ?? known[0];
  const R = TAX_RULES[rulesYear];
  const warning = rulesYear === year ? null : `ยังไม่มีเพดานของปีภาษี ${year + 543} — ใช้ของปีภาษี ${rulesYear + 543} ไปก่อน`;

  const by = new Map(lines.map((l) => [l.code, l]));
  const amt = (code: string) => { const l = by.get(code); return l ? clamp0(num(l.filed_amount) ?? num(l.system_amount) ?? 0) : 0; };
  const qty = (code: string) => { const l = by.get(code); return l ? clamp0(num(l.filed_qty) ?? num(l.qty) ?? 0) : 0; };
  const method = (code: string) => by.get(code)?.method ?? "FLAT";

  // 1) เงินได้พึงประเมิน (ไม่รวม "รอตรวจสอบ")
  const inc = (c: string) => amt(c);
  const i12 = inc("40(1)") + inc("40(2)");
  const i3 = inc("40(3)"), i4 = inc("40(4)"), i5 = inc("40(5)"), i6 = inc("40(6)"), i7 = inc("40(7)"), i8 = inc("40(8)");
  const assessable = r2(i12 + i3 + i4 + i5 + i6 + i7 + i8);

  // 2) ค่าใช้จ่าย: เหมาตามอัตรา · ตามจริง = ยอดใช้ยื่น (หรือยอดจากระบบ) · ไม่หัก = 0
  const steps: TaxStep[] = [{ label: "เงินได้พึงประเมินรวม", amount: assessable, strong: true }];
  const exp12 = method("EXP_40_1_2") === "NONE" ? 0 : Math.min(i12 * R.exp12Pct / 100, R.exp12Cap);
  const exp3 = Math.min(i3 * R.exp3Pct / 100, R.exp3Cap);
  const m5 = method("EXP_40_5");
  const exp5 = m5 === "NONE" ? 0 : m5 === "ACTUAL" ? Math.min(amt("EXP_40_5"), i5) : i5 * R.exp5Pct / 100;
  const m68 = method("EXP_40_6_8");
  const exp68 = m68 === "NONE" ? 0 : m68 === "ACTUAL" ? Math.min(amt("EXP_40_6_8"), i6 + i7 + i8)
    : i6 * R.exp6Pct / 100 + i7 * R.exp7Pct / 100 + i8 * R.exp8Pct / 100;
  const expenses = r2(exp12 + exp3 + exp5 + exp68);
  if (exp12) steps.push({ label: "หัก ค่าใช้จ่าย 40(1)–(2)", amount: -r2(exp12), note: `เหมา ${R.exp12Pct}% ไม่เกิน ${R.exp12Cap.toLocaleString("en-US")}` });
  if (exp3) steps.push({ label: "หัก ค่าใช้จ่าย 40(3)", amount: -r2(exp3), note: `เหมา ${R.exp3Pct}% ไม่เกิน ${R.exp3Cap.toLocaleString("en-US")}` });
  if (exp5) steps.push({ label: "หัก ค่าใช้จ่าย 40(5) ค่าเช่า", amount: -r2(exp5), note: m5 === "ACTUAL" ? "ตามจริง" : `เหมา ${R.exp5Pct}% (บ้าน / อาคาร)` });
  if (exp68) steps.push({ label: "หัก ค่าใช้จ่าย 40(6)–(8)", amount: -r2(exp68), note: m68 === "ACTUAL" ? "ตามจริง" : `เหมา 40(6) ${R.exp6Pct}% · 40(7) ${R.exp7Pct}% · 40(8) ${R.exp8Pct}%` });
  const afterExp = clamp0(assessable - expenses);

  // 3) ค่าลดหย่อน (ตามเพดาน)
  const capped: TaxCalc["capped"] = [];
  const allow = (code: string, label: string, claimed: number, cap: number, note: string) => {
    const allowed = r2(Math.min(claimed, clamp0(cap)));
    if (claimed > allowed + 0.004) capped.push({ code, label, claimed: r2(claimed), allowed, note });
    return allowed;
  };
  const perHead = (code: string, rate: number) => { const l = by.get(code); return l && num(l.filed_amount) != null ? clamp0(num(l.filed_amount)!) : qty(code) * rate; };
  const family = perHead("PERSONAL", R.personal) + perHead("SPOUSE", R.spouse) + perHead("CHILD", R.child)
    + perHead("PARENT", R.parent) + perHead("DISABLED", R.disabled);
  const life = allow("LIFE_INS", "เบี้ยประกันชีวิต", amt("LIFE_INS"), R.lifeIns, `ไม่เกิน ${R.lifeIns.toLocaleString("en-US")}`);
  const health = allow("HEALTH_INS", "เบี้ยประกันสุขภาพ", amt("HEALTH_INS"), Math.min(R.healthIns, R.lifeHealthCombined - life),
    `ไม่เกิน ${R.healthIns.toLocaleString("en-US")} และรวมประกันชีวิตไม่เกิน ${R.lifeHealthCombined.toLocaleString("en-US")}`);
  const parentHealth = allow("PARENT_HEALTH_INS", "เบี้ยประกันสุขภาพบิดามารดา", amt("PARENT_HEALTH_INS"), R.parentHealthIns, `ไม่เกิน ${R.parentHealthIns.toLocaleString("en-US")}`);
  // กลุ่มเกษียณ (บำนาญ · PVD · RMF · SSF) รวมไม่เกิน 500,000
  let room = R.retirementCombined;
  const grp = (code: string, label: string, cap: number, note: string) => {
    const own = Math.min(amt(code), cap);
    const a = allow(code, label, amt(code), Math.min(cap, room), own > room ? `${note} · กลุ่มเกษียณรวมไม่เกิน ${R.retirementCombined.toLocaleString("en-US")}` : note);
    room -= a;
    return a;
  };
  const pension = grp("PENSION_INS", "เบี้ยประกันชีวิตแบบบำนาญ", Math.min(assessable * R.pensionPct / 100, R.pensionCap), `${R.pensionPct}% ของเงินได้ ไม่เกิน ${R.pensionCap.toLocaleString("en-US")}`);
  const pvd = grp("PVD", "กองทุนสำรองเลี้ยงชีพ / กบข.", Math.min(i12 * R.pvdPct / 100, R.pvdCap), `${R.pvdPct}% ของค่าจ้าง ไม่เกิน ${R.pvdCap.toLocaleString("en-US")}`);
  const rmf = grp("RMF", "กองทุน RMF", Math.min(assessable * R.rmfPct / 100, R.rmfCap), `${R.rmfPct}% ของเงินได้ ไม่เกิน ${R.rmfCap.toLocaleString("en-US")}`);
  const ssf = grp("SSF", "กองทุน SSF", Math.min(assessable * R.ssfPct / 100, R.ssfCap), `${R.ssfPct}% ของเงินได้ ไม่เกิน ${R.ssfCap.toLocaleString("en-US")}`);
  const esg = allow("THAI_ESG", "กองทุน Thai ESG", amt("THAI_ESG"), Math.min(assessable * R.thaiEsgPct / 100, R.thaiEsgCap),
    `${R.thaiEsgPct}% ของเงินได้ ไม่เกิน ${R.thaiEsgCap.toLocaleString("en-US")} (แยกจากกลุ่มเกษียณ)`);
  const sso = allow("SOCIAL_SECURITY", "เงินสมทบประกันสังคม", amt("SOCIAL_SECURITY"), R.socialSecurity, `ไม่เกิน ${R.socialSecurity.toLocaleString("en-US")}`);
  const home = allow("HOME_LOAN_INT", "ดอกเบี้ยเงินกู้ซื้อที่อยู่อาศัย", amt("HOME_LOAN_INT"), R.homeLoanInt, `ไม่เกิน ${R.homeLoanInt.toLocaleString("en-US")}`);
  const political = allow("DON_POLITICAL", "เงินบริจาคพรรคการเมือง", amt("DON_POLITICAL"), R.political, `ไม่เกิน ${R.political.toLocaleString("en-US")}`);
  const other = amt("OTHER_DEDUCTION");
  const elderly = opts.age != null && opts.age >= 65 ? Math.min(R.elderlyExempt, afterExp) : 0;
  const deductions = r2(family + life + health + parentHealth + pension + pvd + rmf + ssf + esg + sso + home + political + other + elderly);
  if (family) steps.push({ label: "หัก ลดหย่อนส่วนตัว / ครอบครัว", amount: -r2(family) });
  const ins = life + health + parentHealth + pension;
  if (ins) steps.push({ label: "หัก เบี้ยประกัน", amount: -r2(ins) });
  const funds = pvd + rmf + ssf + esg;
  if (funds) steps.push({ label: "หัก กองทุน (PVD / RMF / SSF / Thai ESG)", amount: -r2(funds) });
  const rest = sso + home + political + other;
  if (rest) steps.push({ label: "หัก ประกันสังคม · ดอกเบี้ยบ้าน · บริจาคพรรคการเมือง · อื่น ๆ", amount: -r2(rest) });
  if (elderly) steps.push({ label: "หัก เงินได้ที่ได้รับยกเว้น (อายุ 65 ปีขึ้นไป)", amount: -r2(elderly), note: `ไม่เกิน ${R.elderlyExempt.toLocaleString("en-US")}` });
  const beforeDon = clamp0(afterExp - deductions);

  // 4) เงินบริจาค: 2 เท่าไม่เกิน 10% ของเงินได้หลังหักค่าใช้จ่าย + ลดหย่อน · ทั่วไปไม่เกิน 10% ของยอดที่เหลือหลังหัก 2 เท่า
  const dbl = allow("DON_DOUBLE", "เงินบริจาค 2 เท่า", amt("DON_DOUBLE") * 2, beforeDon * 0.1, "2 เท่าของยอดบริจาค ไม่เกิน 10% ของเงินได้หลังหักค่าใช้จ่ายและค่าลดหย่อน");
  const gen = allow("DON_GENERAL", "เงินบริจาคทั่วไป", amt("DON_GENERAL"), (beforeDon - dbl) * 0.1, "ไม่เกิน 10% ของเงินได้หลังหักค่าใช้จ่าย ค่าลดหย่อน และบริจาค 2 เท่า");
  const donations = r2(dbl + gen);
  if (donations) steps.push({ label: "หัก เงินบริจาค", amount: -donations });
  const taxable = r2(clamp0(beforeDon - donations));
  steps.push({ label: "เงินได้สุทธิ", amount: taxable, strong: true });

  // 5) ภาษี: ขั้นบันได · วิธีที่ 2 (0.5% ของเงินได้ 40(2)–(8)) เมื่อรวม ≥ 1 ล้าน และภาษีวิธีที่ 2 เกิน 5,000
  const { tax: progressive, rows } = progressiveTax(taxable, R.brackets);
  const other28 = assessable - inc("40(1)");
  const m2 = other28 >= R.minTaxThreshold ? r2(other28 * R.minTaxPct / 100) : 0;
  const minTax = m2 > R.minTaxExempt ? m2 : 0;
  const tax = Math.max(progressive, minTax);
  steps.push({ label: "ภาษีตามอัตราขั้นบันได", amount: progressive });
  if (minTax) steps.push({ label: "ภาษีวิธีที่ 2 (0.5% ของเงินได้ 40(2)–(8))", amount: minTax, note: minTax > progressive ? "สูงกว่าขั้นบันได → ใช้ยอดนี้" : "ต่ำกว่าขั้นบันได" });
  const credits = r2(["WHT", "HALF_YEAR", "DIVIDEND_CREDIT", "OTHER_CREDIT"].reduce((s, c) => s + amt(c), 0));
  if (credits) steps.push({ label: "หัก ภาษีหัก ณ ที่จ่าย / ชำระแล้ว / เครดิต", amount: -credits });
  const result = r2(tax - credits);
  steps.push({ label: result < 0 ? "ขอคืนภาษี" : "ชำระภาษีเพิ่ม", amount: Math.abs(result), strong: true });

  return { rulesYear, warning, assessable, expenses, deductions, donations, taxable, progressive, minTax, tax, credits, result, steps, capped, brackets: rows };
}
