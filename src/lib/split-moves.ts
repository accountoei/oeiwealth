/**
 * บรรทัดแบบ "เคลื่อนเงิน" ที่ก้อนรอแยกรายละเอียดแยกได้ (ใช้ร่วมกันทุกหน้า: Income & Expenses · หนี้สิน · บัตร)
 *   ก้อนค่าใช้จ่ายของบัญชี → โอนไปบัญชีอื่น · จ่ายบัตร · จ่ายหนี้ (เงินต้น)
 *   ก้อนรายได้ของบัญชี → โอนเข้าจากบัญชีอื่น
 *   ก้อนรายได้ของบัตร / หนี้ (ยอดลดเกิน) → จ่ายจากบัญชี
 *   กติกาจริงอยู่ในฐานข้อมูล (public.split_lump)
 */
export type SplitMove = { value: "TRANSFER" | "CARD_PAYMENT" | "LIABILITY_PAYMENT" | "PAY_FROM"; label: string; pick: string;
  targets: { id: string; name: string }[] };

type Lists = {
  banks: { asset_id: string; name: string; currency: string }[];
  cards?: { id: string; label: string; currency: string }[];
  liabs?: { id: string; name: string; currency: string }[];
};
type Lump = { kind: "EXPENSE" | "INCOME"; currency: string; bank?: string | null; card?: string | null; liab?: string | null };

export function splitMoves(l: Lump, { banks, cards = [], liabs = [] }: Lists): SplitMove[] {
  const bankT = banks.filter((b) => b.currency === l.currency && b.asset_id !== l.bank).map((b) => ({ id: b.asset_id, name: b.name }));
  const out: SplitMove[] = [];
  if (l.bank && l.kind === "EXPENSE") {
    out.push({ value: "TRANSFER", label: "เงินโอนไปบัญชีอื่น", pick: "— โอนไปบัญชี —", targets: bankT });
    out.push({ value: "CARD_PAYMENT", label: "จ่ายบัตรเครดิต", pick: "— บัตร —",
      targets: cards.filter((c) => c.currency === l.currency).map((c) => ({ id: c.id, name: c.label })) });
    out.push({ value: "LIABILITY_PAYMENT", label: "จ่ายหนี้ (เงินต้น)", pick: "— หนี้ —",
      targets: liabs.filter((x) => x.currency === l.currency).map((x) => ({ id: x.id, name: x.name })) });
  } else if (l.bank && l.kind === "INCOME") {
    out.push({ value: "TRANSFER", label: "เงินโอนเข้าจากบัญชีอื่น", pick: "— โอนมาจากบัญชี —", targets: bankT });
  } else if ((l.card || l.liab) && l.kind === "INCOME") {
    out.push({ value: "PAY_FROM", label: l.card ? "จ่ายบัตรจากบัญชี" : "จ่ายหนี้จากบัญชี", pick: "— จ่ายจากบัญชี —", targets: bankT });
  }
  return out.filter((m) => m.targets.length > 0);
}
