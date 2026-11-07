import { ShareBox } from "@/components/ShareTable";

export type BarRow = { key: string; label: string; value: number; color: string; sub?: string };

/** สัดส่วนเงินฝาก (ตามธนาคาร / สมาชิก / ประเภทบัญชี) · ยอดเป็นบาท · เรียงมาก → น้อย · ตารางชุดเดียวกับหน้าอื่น (ShareBox · ตกลง 7 พ.ย. 2026) */
export default function ShareBars({ title, rows, note, footer, head, className }: { title: string; rows: BarRow[]; note?: string; footer?: React.ReactNode; head?: string;
  /** เช่น flex-1 = ยืดให้ขอบล่างเท่ากล่องข้าง ๆ */ className?: string }) {
  const sorted = [...rows].filter((r) => Math.abs(r.value) > 0.005).sort((a, b) => b.value - a.value);
  return (
    <ShareBox title={title} sub={note} label={head ?? (title.includes("สมาชิก") ? "สมาชิก" : "ธนาคาร")} footer={footer} className={className}
      rows={sorted.map((r) => ({ key: r.key, name: r.label, value: r.value, color: r.color, sub: r.sub }))} />
  );
}
