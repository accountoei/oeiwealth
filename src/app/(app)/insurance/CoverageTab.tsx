import Link from "next/link";
import type { ReactNode } from "react";
import { CLAIM_CLS, CLAIM_DONE, CLAIM_OPEN, CLAIM_STATUS, COVERAGE_ANNUAL, COVERAGE_GROUPS, COVERAGE_LABEL, COVERAGE_NOSUM, covAmount, covExtra, covName, money, thDate } from "@/lib/format";
import { StatBox } from "@/components/Boxes";
import ModalButton from "@/components/ModalButton";
import RowActions from "@/components/RowActions";
import { InfoTip } from "@/components/HeaderBar";
import { ShowAllBox, ShowAllButton } from "@/components/ShowAllToggle";
import ClaimForm, { type ClaimCoverageOpt, type ClaimPolicyOpt } from "./[id]/ClaimForm";
import ClaimReceiveForm, { type PendingExpense } from "./[id]/ClaimReceiveForm";

/**
 * แท็บ "ความคุ้มครอง" หน้า Insurance (ตกลง 3 พ.ย. 2026 · แท็บท้ายสุด)
 *   ทั้งครอบครัว = ตาราง ประเภท × คน (ย้ายมาจากภาพรวม) · เลือกคน = แยกตามกรมธรรม์ + ใช้ปีนี้ / คงเหลือ / สิ้นสุด
 *   การ์ดสรุป 4 กล่อง · เคลมปีนี้ · ปุ่มพิมพ์สรุปสำหรับโรงพยาบาล (/print/insurance)
 *   (8 พ.ย. 2026: เหลือ 4 กล่องแบบหน้าอื่น · เลิกกล่อง "เรื่องที่ควรดู" → ยังไม่มีประกันสุขภาพ อยู่ใต้กล่องค่ารักษา
 *    กล่องเคลม: ปุ่ม + บันทึกเคลม (เลือกกรมธรรม์) · กดแถว = แก้ไข / ลบ · ปุ่มบันทึกรับเงินต่อแถว · เคลมปีก่อนที่ยังรอรับแสดงด้วย)
 *   ทุนชีวิต / อุบัติเหตุ: กรมธรรม์ชีวิต / อุบัติเหตุที่ยังไม่ได้กรอกความคุ้มครองประเภทนั้น ใช้ทุนประกันของกรมธรรม์แทน
 *   แสดงเฉพาะหัวข้อที่มีอย่างน้อย 1 รายการ (กลุ่มที่ไม่มีเลยซ่อนหัวกลุ่ม) · "แสดงทุกหัวข้อ" = ครบตามตารางมาตรฐาน (ตกลง 8 พ.ย. 2026)
 *     ตารางทั้งครอบครัว: หัวข้อที่แสดง ช่องของคนที่ไม่มี = "ยังไม่มี" (ดูว่าใครยังขาดสิทธิ์ไหน)
 *   คุ้มครองเฉพาะ (เช่น มะเร็ง · ตั้งต่อส่วนของเล่ม) = แถวแยก ไม่บวกกับวงเงินทั่วไป / การ์ดสรุป · "อื่น ๆ" ที่ตั้งชื่อ = แถวตามชื่อ
 */
export type CovPolicy = { id: string; name: string; type: string; personId: string | null; endDate: string | null; expiring: boolean; expired: boolean;
  premium: number; premiumCcy: string; hasCov: boolean; plan: string | null; scope: string | null };
export type CovItem = { policyId: string; personId: string; type: string; limit: number; used: number; currency: string; notes: string | null; fromPolicy?: boolean;
  maxCount?: number | null; period?: string | null; label?: string | null; scope: string | null };
export type CovClaim = { id: string; policyId: string; personId: string | null; coverageType: string | null; coverageLabel?: string | null; date: string | null; claimed: number; received: number;
  currency: string; status: string; notes: string | null; claimDate: string | null; claimedRaw: number | null; receivedRaw: number | null;
  /** ยื่นในปีที่เลือก (ไม่ใช่เคลมปีก่อนที่ยังรอรับ) */ inYear: boolean };
/** ข้อมูลของปุ่มบันทึกเคลม / บันทึกรับเงิน */
export type ClaimKit = { policies: ClaimPolicyOpt[]; coverages: ClaimCoverageOpt[]; banks: { asset_id: string; name: string; currency: string; frequent?: boolean | null }[];
  persons: { id: string; name: string }[]; expenses: (PendingExpense & { currency: string })[]; today: string; minDate: string | null; canDelete: boolean };

const HEALTH_TYPES = COVERAGE_GROUPS.find(([g]) => g === "สุขภาพ")?.[1] ?? [];
const NONE = <span className="text-xs text-slate-400">ยังไม่มี</span>;
/** วงเงินของรายการเดียว (ยกเว้นเบี้ย = มีสิทธิ์ · ร่วมจ่าย = % · สูงสุด N วัน ต่อปี) */
const one = (x: CovItem) => {
  const extra = covExtra({ coverage_type: x.type, max_count: x.maxCount, count_period: x.period, label: x.label });
  return `${covAmount(x.type, x.limit, ccy(x.currency), 0)}${extra ? ` · ${extra}` : ""}`;
};
/** แถวของตาราง = หัวข้อ + คุ้มครองเฉพาะ + ชื่อ ("อื่น ๆ") */
type Spec = { key: string; type: string; scope: string | null; label: string | null };
const specKey = (type: string, scope: string | null, label: string | null) => `${type}|${scope ?? ""}|${type === "OTHER" ? label ?? "" : ""}`;
const keyOf = (x: CovItem) => specKey(x.type, x.scope, x.label ?? null);
/** แถวที่ซ่อนไว้จนกด "แสดงทุกหัวข้อ" (ShowAllBox) */
const HIDE_ROW = "hidden group-data-[all=1]/all:table-row";
const HIDE_GROUP = "hidden group-data-[all=1]/all:table-row-group";
const CLAIM = Object.fromEntries(CLAIM_STATUS);
const ccy = (c: string) => (c !== "THB" ? c : undefined);
const LINK = "tabular-nums text-slate-900 underline decoration-dotted underline-offset-4 hover:text-blue-700";
/** คอลัมน์แรกของตารางทั้งครอบครัว: ล็อกไว้ทางซ้าย เลื่อนดูสมาชิกที่เพิ่มขึ้นได้โดยยังเห็นชื่อความคุ้มครอง (ใส่สีพื้นที่ช่องเอง) */
const STICKY = "sticky left-0 z-10 min-w-40 shadow-[inset_-1px_0_0_var(--color-slate-200)]";

/** ยอดรวมแยกสกุลเงิน (THB ขึ้นก่อน) */
function byCcy(xs: { amount: number; currency: string }[]) {
  const m = new Map<string, number>();
  xs.forEach((x) => m.set(x.currency, (m.get(x.currency) ?? 0) + x.amount));
  return [...m.entries()].sort(([a], [b]) => (a === "THB" ? -1 : b === "THB" ? 1 : a.localeCompare(b)));
}
/** ยอดการ์ด (THB · เฉพาะความคุ้มครองทั่วไป ไม่รวมคุ้มครองเฉพาะ) */
const thb = (xs: CovItem[], type: string) => xs.filter((x) => x.type === type && !x.scope && x.currency === "THB").reduce((t, x) => t + x.limit, 0);
const label = (k: string, scope?: string | null, name?: string | null) => <>{covName(k, name)}{COVERAGE_LABEL[k]?.[1] && <span className="text-xs text-slate-500"> {COVERAGE_LABEL[k][1]}</span>}
  {scope && <span className="ml-1 rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700">เฉพาะ{scope}</span>}</>;
const specName = (sp: Spec) => [covName(sp.type, sp.label), sp.scope && `เฉพาะ${sp.scope}`].filter(Boolean).join(" · ");

export default function CoverageTab({ persons, personId, personName, policies, items, claims, year, printHref, canWrite, filter, kit }: {
  persons: { id: string; name: string }[]; personId: string; personName: string; policies: CovPolicy[]; items: CovItem[]; claims: CovClaim[];
  year: string; printHref: string; canWrite: boolean;
  /** ตัวกรองบริษัทประกัน (ต่อจากชื่อกล่อง) */ filter?: ReactNode;
  kit: ClaimKit;
}) {
  const pname = new Map(persons.map((p) => [p.id, p.name]));
  const policy = new Map(policies.map((p) => [p.id, p]));
  const active = policies.filter((p) => p.personId && pname.has(p.personId));
  const mine = items.filter((x) => pname.has(x.personId));
  const of = (pid: string) => mine.filter((x) => x.personId === pid);

  // การ์ด (THB): ค่าห้องต่อวัน ทั้งครอบครัว = สูงสุดรายคน (รวมข้ามคนไม่มีความหมาย)
  const roomOf = (pid: string) => thb(of(pid), "ROOM_PER_DAY");
  const roomMax = personId ? roomOf(personId) : Math.max(0, ...persons.map((p) => roomOf(p.id)));
  const roomWho = personId ? "" : persons.find((p) => roomMax > 0 && roomOf(p.id) === roomMax)?.name ?? "";
  const who = personId ? personName : "ทั้งครอบครัว";
  // มีประกันสุขภาพทั่วไป (สัญญาที่คุ้มครองเฉพาะโรค เช่น มะเร็ง ไม่นับ) → บรรทัดใต้กล่องค่ารักษา (แทนกล่อง "เรื่องที่ควรดู")
  const hasHealth = persons.filter((p) => active.some((x) => x.personId === p.id && x.type === "HEALTH" && !x.scope)
    || of(p.id).some((x) => HEALTH_TYPES.includes(x.type) && !x.scope)).length;
  const healthSub = personId ? (hasHealth ? "มีประกันสุขภาพ" : "ยังไม่มีประกันสุขภาพ") : `มีประกันสุขภาพ ${hasHealth} จาก ${persons.length} คน`;
  const pol = (id: string) => <Link href={`/insurance/${id}`} className="font-medium hover:underline">{policy.get(id)?.name ?? "กรมธรรม์"}</Link>;

  // ตาราง: แถวตามหัวข้อมาตรฐาน (ทั่วไป) + แถวคุ้มครองเฉพาะ / "อื่น ๆ" ที่ตั้งชื่อ ที่มีจริงในมุมมองนี้
  const covPersons = persons;
  const view = personId ? of(personId) : mine;
  const has = new Set(view.map(keyOf));
  const groups = COVERAGE_GROUPS.map(([g, ks]) => {
    const specs: Spec[] = ks.flatMap((k) => {
      const extra = new Map<string, Spec>();
      view.filter((x) => x.type === k).forEach((x) => {
        const key = keyOf(x);
        if (key !== specKey(k, null, null)) extra.set(key, { key, type: k, scope: x.scope, label: x.type === "OTHER" ? x.label ?? null : null });
      });
      const sorted = [...extra.values()].sort((a, b) => (a.scope ?? "").localeCompare(b.scope ?? "", "th") || (a.label ?? "").localeCompare(b.label ?? "", "th"));
      return [{ key: specKey(k, null, null), type: k, scope: null, label: null }, ...sorted];
    });
    return { g, specs, any: specs.some((sp) => has.has(sp.key)) };
  });
  const rowCls = (sp: Spec) => (has.has(sp.key) ? "" : HIDE_ROW);
  const groupCls = (any: boolean) => (any ? "" : HIDE_GROUP);
  /** ไม่มีรายการเลยในมุมมองนี้ (ซ่อนเมื่อกดแสดงทุกหัวข้อ) */
  const emptyNote = (cols: number) => has.size === 0 && (
    <tbody className="group-data-[all=1]/all:hidden"><tr><td colSpan={cols} className="px-4 py-6 text-center text-sm text-slate-500">ยังไม่มีรายการความคุ้มครอง · กด &ldquo;แสดงทุกหัวข้อ&rdquo; เพื่อดูหัวข้อทั้งหมด</td></tr></tbody>
  );
  const polText = (id: string) => <><Link href={`/insurance/${id}`} className="hover:underline">{policy.get(id)?.name ?? "-"}</Link>
    {policy.get(id)?.plan && <span className="text-xs text-slate-500"> · {policy.get(id)?.plan}</span>}</>;
  const myClaims = claims.filter((c) => c.personId && pname.has(c.personId));
  const live = (c: CovClaim) => !["REJECTED", "CANCELLED"].includes(c.status);
  // กล่องเคลมปีนี้ (THB · ไม่นับปฏิเสธ / ยกเลิก) · รอรับ = ยอดเคลม − ได้รับ ของเคลมที่ยื่นแล้วยังไม่จบ (รวมปีก่อน)
  const yearClaims = myClaims.filter((c) => c.inYear && live(c) && c.currency === "THB");
  const waitOf = (c: CovClaim) => (CLAIM_OPEN.includes(c.status) ? Math.max(c.claimed - c.received, 0) : 0);
  const waitThb = myClaims.filter((c) => c.currency === "THB").reduce((t, c) => t + waitOf(c), 0);
  const older = myClaims.some((c) => !c.inYear);

  const detail = (xs: CovItem[], annual: boolean) => (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">กรมธรรม์</th><th className="text-right">วงเงิน</th>{annual && <th className="text-right">ใช้ปีนี้</th>}</tr></thead>
      <tbody className="divide-y divide-slate-100">
        {xs.map((it, n) => (
          <tr key={n} className="align-top"><td className="py-1.5">{polText(it.policyId)}
            {(it.notes || it.fromPolicy) && <div className="text-xs text-slate-500">{it.fromPolicy ? "ทุนประกันของกรมธรรม์" : it.notes}</div>}</td>
            <td className="text-right tabular-nums">{one(it)}</td>
            {annual && <td className="text-right tabular-nums">{it.used > 0 ? money(it.used, undefined, 0) : "-"}</td>}</tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="space-y-6">
      {/* กล่องสรุป 4 อัน แบบหน้าอื่น (ตกลง 8 พ.ย. 2026) · ทุนประกันชีวิต / เบี้ย ดูที่แท็บภาพรวม */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatBox label="ค่ารักษาผู้ป่วยใน ต่อปี (THB)" value={money(persons.reduce((t, p) => t + thb(of(p.id), "IPD_ANNUAL"), 0), undefined, 0)}
          sub={healthSub} subClass={hasHealth < persons.length ? "text-amber-700" : undefined} />
        <StatBox label="ค่าห้อง ต่อวัน (THB)" value={money(roomMax, undefined, 0)} sub={personId ? personName : roomWho ? `สูงสุดรายคน · ${roomWho}` : "สูงสุดรายคน"} />
        <StatBox label="โรคร้ายแรง (THB)" value={money(persons.reduce((t, p) => t + thb(of(p.id), "CRITICAL_ILLNESS"), 0), undefined, 0)} sub={who} />
        <StatBox label={`เคลมปี ${Number(year) + 543} (THB)`} value={money(yearClaims.reduce((t, c) => t + c.claimed, 0), undefined, 0)}
          sub={<>ได้รับ {money(yearClaims.reduce((t, c) => t + c.received, 0), undefined, 0)}{waitThb > 0.005 && <> · <span className="text-amber-700">รอรับ {money(waitThb, undefined, 0)}</span></>}</>} />
      </section>

      {/* เลื่อนซ้าย-ขวาเฉพาะตาราง (หัวกล่อง / ปุ่มพิมพ์ / คำอธิบายอยู่กับที่) · ซ่อนหัวข้อที่ไม่มีใคร + ปุ่มแสดงทุกหัวข้อ */}
      <ShowAllBox className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <div className="flex flex-wrap items-center gap-3 text-sm"><h2 className="text-base font-medium text-slate-900">ความคุ้มครอง · {who} <InfoTip label="คำอธิบาย">จากกรมธรรม์ที่มีผลตามผู้เอาประกัน · แสดงเฉพาะหัวข้อที่มีอย่างน้อย 1 รายการ (กด &ldquo;แสดงทุกหัวข้อ&rdquo; เพื่อดูครบ) · วงเงินต่อปีหักยอดเคลมปีนี้ · กรมธรรม์ชีวิต / อุบัติเหตุที่ยังไม่ได้กรอกความคุ้มครองใช้ทุนประกันของกรมธรรม์ · คุ้มครองเฉพาะ (เช่น มะเร็ง) แยกแถวไว้ ไม่บวกกับวงเงินทั่วไป · กดตัวเลขเพื่อดูว่ามาจากกรมธรรม์ไหน · เลือกคนที่แถบบนเพื่อดูแยกตามกรมธรรม์</InfoTip></h2>
            <ShowAllButton />{filter}</div>
          <Link href={printHref} target="_blank" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">พิมพ์สรุปสำหรับโรงพยาบาล</Link>
        </div>
        {covPersons.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-500">ยังไม่มีสมาชิกในมุมมองนี้</p>
          : personId ? (
          <div className="overflow-x-auto"><table className="mt-2 w-full min-w-[44rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">ความคุ้มครอง / กรมธรรม์</th><th className="px-4 text-right">วงเงิน</th><th className="px-4 text-right">ใช้ปีนี้</th><th className="px-4 text-right">คงเหลือ</th><th className="px-4">สิ้นสุด</th></tr>
            </thead>
            {emptyNote(5)}
            {groups.map(({ g, specs, any }) => (
              <tbody key={g} className={`divide-y divide-slate-100 border-t border-slate-200 ${groupCls(any)}`}>
                <tr className="bg-slate-50/60"><td colSpan={5} className="px-4 py-1.5 text-xs font-medium text-slate-600">{g}</td></tr>
                {specs.map((sp) => {
                  const xs = of(personId).filter((x) => keyOf(x) === sp.key);
                  const k = sp.type;
                  const annual = COVERAGE_ANNUAL.includes(k);
                  return [
                    <tr key={sp.key} className={`font-medium ${rowCls(sp)}`}>
                      <td className="px-4 py-2">{label(k, sp.scope, sp.label)}</td>
                      <td className="px-4 text-right tabular-nums">{xs.length === 0 ? NONE : COVERAGE_NOSUM.includes(k) ? ""
                        : byCcy(xs.map((x) => ({ amount: x.limit, currency: x.currency }))).map(([c, v]) => <div key={c}>{money(v, ccy(c), 0)}</div>)}</td>
                      <td className="px-4 text-right tabular-nums">{annual && xs.length > 0 ? money(xs.reduce((t, x) => t + x.used, 0), undefined, 0) : ""}</td>
                      <td className="px-4 text-right tabular-nums">{annual && xs.length > 0 ? money(xs.reduce((t, x) => t + Math.max(x.limit - x.used, 0), 0), undefined, 0) : ""}</td>
                      <td></td>
                    </tr>,
                    ...xs.map((x, n) => (
                      <tr key={`${sp.key}${n}`} className="align-top text-slate-600">
                        <td className="py-1.5 pl-8 pr-4">{polText(x.policyId)}
                          {(x.notes || x.fromPolicy) && <div className="text-xs text-slate-500">{x.fromPolicy ? "ทุนประกันของกรมธรรม์" : x.notes}</div>}</td>
                        <td className="px-4 text-right tabular-nums">{one(x)}</td>
                        <td className="px-4 text-right tabular-nums">{annual ? (x.used > 0 ? money(x.used, undefined, 0) : "-") : ""}</td>
                        <td className={`px-4 text-right tabular-nums ${annual && x.limit > 0 && x.used / x.limit >= 0.8 ? "text-red-700" : ""}`}>{annual ? money(Math.max(x.limit - x.used, 0), undefined, 0) : ""}</td>
                        <td className="whitespace-nowrap px-4 text-xs">{thDate(policy.get(x.policyId)?.endDate)}
                          {policy.get(x.policyId)?.expiring && <div className="text-amber-700">ใกล้ครบ</div>}
                          {policy.get(x.policyId)?.expired && <div className="text-red-600">เลยวันสิ้นสุด</div>}</td>
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            ))}
          </table></div>
        ) : (
          <div className="overflow-x-auto"><table className="mt-2 w-full min-w-[36rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className={`${STICKY} bg-slate-50 px-4 py-2`}>ความคุ้มครอง</th>{covPersons.map((p) => <th key={p.id} className="px-4 text-right">{p.name}</th>)}</tr>
            </thead>
            {emptyNote(covPersons.length + 1)}
            {groups.map(({ g, specs, any }) => (
              <tbody key={g} className={`divide-y divide-slate-100 border-t border-slate-200 ${groupCls(any)}`}>
                <tr className="bg-slate-50/60"><td colSpan={covPersons.length + 1} className="px-4 py-1.5 text-xs font-medium text-slate-600"><span className="sticky left-4 inline-block">{g}</span></td></tr>
                {specs.map((sp) => {
                  const k = sp.type;
                  return (
                    <tr key={sp.key} className={`align-top ${rowCls(sp)}`}>
                      <td className={`${STICKY} bg-white px-4 py-2`}>{label(k, sp.scope, sp.label)}</td>
                      {covPersons.map((p) => {
                        const xs = of(p.id).filter((x) => keyOf(x) === sp.key);
                        if (xs.length === 0) return <td key={p.id} className="px-4 py-2 text-right">{NONE}</td>;
                        const annual = COVERAGE_ANNUAL.includes(k);
                        if (COVERAGE_NOSUM.includes(k)) return (
                          <td key={p.id} className="px-4 py-2 text-right">
                            <ModalButton label={xs.length === 1 ? one(xs[0]) : `${xs.length} กรมธรรม์`} title={`${specName(sp)} · ${p.name}`} className={LINK}>{detail(xs, false)}</ModalButton>
                          </td>
                        );
                        const lim = xs.filter((x) => x.currency === "THB").reduce((t, x) => t + x.limit, 0);
                        const used = xs.reduce((t, x) => t + x.used, 0);
                        return (
                          <td key={p.id} className="px-4 py-2 text-right">
                            {byCcy(xs.map((x) => ({ amount: x.limit, currency: x.currency }))).map(([c, v]) => (
                              <div key={c}><ModalButton label={money(v, ccy(c), 0)} title={`${specName(sp)} · ${p.name}`} className={LINK}>{detail(xs, annual)}</ModalButton></div>
                            ))}
                            {xs.length > 1 && <div className="text-xs text-slate-400">{xs.length} กรมธรรม์</div>}
                            {annual && used > 0 && <div className={`text-xs ${lim > 0 && used / lim >= 0.8 ? "text-red-700" : "text-slate-500"}`}>เหลือ {money(Math.max(lim - used, 0), undefined, 0)}</div>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table></div>
        )}
      </ShowAllBox>

      {/* เคลม (ตกลง 8 พ.ย. 2026): ปุ่ม + บันทึกเคลม มุมขวา · กดแถว = แก้ไข / ลบ · บันทึกรับเงินท้ายแถว · เคลมปีก่อนที่ยังรอรับแสดงต่อท้าย */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <h2 className="font-medium text-slate-900">เคลมปี {Number(year) + 543} · {who}{older && <span className="text-xs font-normal text-slate-500"> (รวมเคลมปีก่อนที่ยังรอรับ)</span>}</h2>
          {canWrite && kit.policies.length > 0 && <ClaimForm policies={kit.policies} coverages={kit.coverages} today={kit.today} />}
        </div>
        <div className="overflow-x-auto">
        <table className="mt-2 w-full min-w-[48rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">วันที่</th><th className="px-4">ผู้เอาประกัน</th><th className="px-4">กรมธรรม์ / ความคุ้มครอง</th>
              <th className="px-4 text-right">ยอดยื่น</th><th className="px-4 text-right">ได้รับ</th><th className="px-4">สถานะ</th><th className="px-4"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {myClaims.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">ยังไม่มีเคลมในปีนี้</td></tr>}
            {myClaims.map((c) => {
              const c2 = c.currency !== "THB" ? c.currency : undefined;
              const wait = waitOf(c);
              const rest = Math.round((c.claimed - c.received) * 100) / 100;   // ยอดที่ยังรับได้ (เคลมร่างก็บันทึกรับได้)
              return (
                <tr key={c.id} className={`align-top ${live(c) ? "" : "text-slate-400"}`}>
                  <td className="whitespace-nowrap px-4 py-2">{thDate(c.date)}</td>
                  <td className="px-4 py-2">{c.personId ? pname.get(c.personId) : "-"}</td>
                  <td className="px-4 py-2">{pol(c.policyId)}{c.coverageType && <span className="text-xs text-slate-500"> · {covName(c.coverageType, c.coverageLabel)}</span>}
                    {c.notes && <div className="text-xs text-slate-500">{c.notes}</div>}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{money(c.claimed, c2)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                    <span className="text-emerald-700">{c.received > 0 ? money(c.received, c2) : "-"}</span>
                    {wait > 0.005 && <div className="text-xs text-amber-700">รอรับ {money(wait, c2)}</div>}</td>
                  <td className="px-4 py-2 text-xs"><span className={`whitespace-nowrap rounded px-1.5 py-0.5 ${CLAIM_CLS[c.status] ?? "bg-slate-100 text-slate-600"}`}>{CLAIM[c.status] ?? c.status}</span></td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    {canWrite && rest > 0.005 && !CLAIM_DONE.includes(c.status) && <ClaimReceiveForm claimId={c.id} claimDate={c.claimDate} currency={c.currency}
                      claimed={c.claimed} wait={rest} banks={kit.banks} persons={kit.persons} today={kit.today} minDate={kit.minDate}
                      expenses={kit.expenses.filter((e) => e.currency === c.currency)} />}
                    {canWrite && <RowActions table="insurance_claims" id={c.id} paths={["/insurance", `/insurance/${c.policyId}`, "/family/health"]} canDelete={kit.canDelete} fields={[
                      { name: "claim_date", label: "ยื่นเคลม", type: "date", value: c.claimDate },
                      { name: "claimed_amount", label: "ยอดเคลม", type: "number", value: c.claimedRaw },
                      { name: "received_amount", label: "ได้รับ", type: "number", value: c.receivedRaw },
                      { name: "status", label: "สถานะ", type: "select", value: c.status, options: CLAIM_STATUS },
                      { name: "notes", label: "หมายเหตุ", value: c.notes, width: "w-40" }]} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {myClaims.length > 0 && <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium"><tr><td colSpan={3} className="px-4 py-2">รวม (THB · ไม่นับปฏิเสธ / ยกเลิก)</td>
            <td className="px-4 text-right tabular-nums">{money(myClaims.filter((c) => live(c) && c.currency === "THB").reduce((t, c) => t + c.claimed, 0))}</td>
            <td className="px-4 text-right tabular-nums text-emerald-700">{money(myClaims.filter((c) => live(c) && c.currency === "THB").reduce((t, c) => t + c.received, 0))}</td><td colSpan={2}></td></tr></tfoot>}
        </table>
        </div>
        <div className="h-3" />
      </section>
    </div>
  );
}
