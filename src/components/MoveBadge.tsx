import { TONE_CLS, type Tone } from "@/lib/ledger";

/** ป้ายประเภทรายการเงินเข้า–ออก (สีตาม src/lib/ledger.ts) */
export default function MoveBadge({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_CLS[tone]}`}>{label}</span>;
}
