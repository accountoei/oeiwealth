import Link from "next/link";
import { CLAIM_STATUS, COVERAGE_ANNUAL, COVERAGE_LABEL, money, thDate } from "@/lib/format";
import { StatBox } from "@/components/Boxes";
import ModalButton from "@/components/ModalButton";
import { InfoTip } from "@/components/HeaderBar";

/**
 * แท็บ "ความคุ้มครอง" หน้า Insurance (ตกลง 3 พ.ย. 2026 · แท็บท้ายสุด)
 *   ทั้งครอบครัว = ตาราง ประเภท × คน (ย้ายมาจากภาพรวม) · เลือกคน = แยกตามกรมธรรม์ + ใช้ปีนี้ / คงเหลือ / สิ้นสุด
 *   การ์ดสรุป · กล่องเตือน · เคลมปีนี้ · ปุ่มพิมพ์สรุปสำหรับโรงพยาบาล (/print/insurance)
 *   ทุนชีวิต / อุบัติเหตุ: กรมธรรม์ชีวิต / อุบัติเหตุที่ยังไม่ได้กรอกความคุ้มครองประเภทนั้น ใช้ทุนประกันของกรมธรรม์แทน
 */
export type CovPolicy = { id: string; name: string; type: string; personId: string | null; endDate: string | null; expiring: boolean; expired: boolean;
  premium: number; premiumCcy: string; hasCov: boolean };
export type CovItem = { policyId: string; personId: string; type: string; limit: number; used: number; currency: string; notes: string | null; fromPolicy?: boolean };
export type CovClaim = { id: string; policyId: string; personId: string | null; coverageType: string | null; date: string | null; claimed: number; received: number;
  currency: string; status: string; notes: string | null };

const GROUPS: [string, string[]][] = [
  ["สุขภาพ", ["IPD_ANNUAL", "IPD_PER_ADMIT", "ROOM_PER_DAY", "OPD_PER_VISIT", "OPD_ANNUAL", "HOSPITAL_CASH_PER_DAY"]],
  ["ชีวิตและอุบัติเหตุ", ["LIFE", "ACCIDENT_DEATH", "DISABILITY"]],
  ["โรคร้ายแรง", ["CRITICAL_ILLNESS"]],
  ["อื่น ๆ", ["OTHER"]],
];
const HEALTH_TYPES = GROUPS[0][1];
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
const thb = (xs: CovItem[], type: string) => xs.filter((x) => x.type === type && x.currency === "THB").reduce((t, x) => t + x.limit, 0);
const label = (k: string) => <>{COVERAGE_LABEL[k]?.[0] ?? k}{COVERAGE_LABEL[k]?.[1] && <span className="text-xs text-slate-500"> {COVERAGE_LABEL[k][1]}</span>}</>;

export default function CoverageTab({ persons, personId, personName, policies, items, claims, year, printHref, canWrite }: {
  persons: { id: string; name: string }[]; personId: string; personName: string; policies: CovPolicy[]; items: CovItem[]; claims: CovClaim[];
  year: string; printHref: string; canWrite: boolean;
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
  const healthPremium = active.filter((p) => p.type === "HEALTH" && p.premiumCcy === "THB").reduce((t, p) => t + p.premium, 0);
  const who = personId ? personName : "ทั้งครอบครัว";

  // กล่องเตือน (เฉพาะเรื่องความคุ้มครอง · เบี้ยเลยกำหนด / ใกล้ครบ ดูที่แท็บภาพรวม · ไม่มีเรื่อง = ไม่แสดงกล่อง)
  const noHealth = persons.filter((p) => !active.some((x) => x.personId === p.id && x.type === "HEALTH") && !of(p.id).some((x) => HEALTH_TYPES.includes(x.type)));
  const noLife = persons.filter((p) => !of(p.id).some((x) => x.type === "LIFE"));
  const highUse = mine.filter((x) => COVERAGE_ANNUAL.includes(x.type) && x.limit > 0 && x.used / x.limit >= 0.8);
  const noCov = active.filter((p) => p.type === "HEALTH" && !p.hasCov);
  const alerts = noHealth.length + noLife.length + highUse.length + noCov.length;
  const pol = (id: string) => <Link href={`/insurance/${id}`} className="font-medium hover:underline">{policy.get(id)?.name ?? "กรมธรรม์"}</Link>;

  // ตาราง
  const covPersons = persons.filter((p) => of(p.id).length > 0);
  const groups = GROUPS.map(([g, ks]) => [g, ks.filter((k) => mine.some((x) => x.type === k))] as const).filter(([, ks]) => ks.length > 0);
  const myClaims = claims.filter((c) => c.personId && pname.has(c.personId));
  const live = (c: CovClaim) => !["REJECTED", "CANCELLED"].includes(c.status);

  const detail = (xs: CovItem[], annual: boolean) => (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">กรมธรรม์</th><th className="text-right">วงเงิน</th>{annual && <th className="text-right">ใช้ปีนี้</th>}</tr></thead>
      <tbody className="divide-y divide-slate-100">
        {xs.map((it, n) => (
          <tr key={n} className="align-top"><td className="py-1.5"><Link href={`/insurance/${it.policyId}`} className="hover:underline">{policy.get(it.policyId)?.name ?? "-"}</Link>
            {(it.notes || it.fromPolicy) && <div className="text-xs text-slate-500">{it.fromPolicy ? "ทุนประกันของกรมธรรม์" : it.notes}</div>}</td>
            <td className="text-right tabular-nums">{money(it.limit, ccy(it.currency), 0)}</td>
            {annual && <td className="text-right tabular-nums">{it.used > 0 ? money(it.used, undefined, 0) : "-"}</td>}</tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatBox label="ทุนประกันชีวิต (THB)" value={money(persons.reduce((t, p) => t + thb(of(p.id), "LIFE"), 0), undefined, 0)} sub={who} />
        <StatBox label="ค่ารักษาผู้ป่วยใน ต่อปี (THB)" value={money(persons.reduce((t, p) => t + thb(of(p.id), "IPD_ANNUAL"), 0), undefined, 0)} sub={who} />
        <StatBox label="ค่าห้อง ต่อวัน (THB)" value={money(roomMax, undefined, 0)} sub={personId ? personName : roomWho ? `สูงสุดรายคน · ${roomWho}` : "สูงสุดรายคน"} />
        <StatBox label="โรคร้ายแรง (THB)" value={money(persons.reduce((t, p) => t + thb(of(p.id), "CRITICAL_ILLNESS"), 0), undefined, 0)} sub={who} />
        <StatBox label="เบี้ยประกันสุขภาพ ต่อปี (THB)" value={money(healthPremium, undefined, 0)} sub={`${active.filter((p) => p.type === "HEALTH").length} กรมธรรม์`} />
      </section>

      {alerts > 0 && (
        <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm">
          <h2 className="font-medium text-slate-900">เรื่องที่ควรดู</h2>
          <ul className="list-disc space-y-1 pl-5">
            {noCov.length > 0 && <li>กรมธรรม์สุขภาพที่ยังไม่ได้กรอกความคุ้มครอง ({noCov.length}): {noCov.map((p, i) => <span key={p.id}>{i > 0 && ", "}{pol(p.id)}</span>)}
              <span className="text-xs text-slate-500"> · กรอกที่หน้ากรมธรรม์ → ความคุ้มครอง</span></li>}
            {highUse.map((x, i) => <li key={`u${i}`}>{label(x.type)} · {pname.get(x.personId)} ({pol(x.policyId)}) ใช้ไป {money(x.used, undefined, 0)} จาก {money(x.limit, undefined, 0)}
              {" "}<span className={x.used >= x.limit ? "text-red-700" : "text-amber-800"}>({Math.round((x.used / x.limit) * 100)}%)</span></li>)}
            {noHealth.length > 0 && <li>ยังไม่มีประกันสุขภาพ: {noHealth.map((p) => p.name).join(", ")}</li>}
            {noLife.length > 0 && <li>ยังไม่มีทุนประกันชีวิต: {noLife.map((p) => p.name).join(", ")}</li>}
          </ul>
        </section>
      )}

      {/* เลื่อนซ้าย-ขวาเฉพาะตาราง (หัวกล่อง / ปุ่มพิมพ์ / คำอธิบายอยู่กับที่) */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <h2 className="font-medium text-slate-900">ความคุ้มครอง · {who} <InfoTip label="คำอธิบาย">จากกรมธรรม์ที่มีผลตามผู้เอาประกัน · วงเงินต่อปีหักยอดเคลมปีนี้ · กรมธรรม์ชีวิต / อุบัติเหตุที่ยังไม่ได้กรอกความคุ้มครองใช้ทุนประกันของกรมธรรม์ · กดตัวเลขเพื่อดูว่ามาจากกรมธรรม์ไหน · เลือกคนที่แถบบนเพื่อดูแยกตามกรมธรรม์</InfoTip></h2>
          <Link href={printHref} target="_blank" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">พิมพ์สรุปสำหรับโรงพยาบาล</Link>
        </div>
        {groups.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-500">ยังไม่มีข้อมูลความคุ้มครอง · กรอกได้ที่หน้ากรมธรรม์แต่ละฉบับ</p>
          : personId ? (
          <div className="overflow-x-auto"><table className="mt-2 w-full min-w-[44rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">ความคุ้มครอง / กรมธรรม์</th><th className="px-4 text-right">วงเงิน</th><th className="px-4 text-right">ใช้ปีนี้</th><th className="px-4 text-right">คงเหลือ</th><th className="px-4">สิ้นสุด</th></tr>
            </thead>
            {groups.map(([g, ks]) => (
              <tbody key={g} className="divide-y divide-slate-100 border-t border-slate-200">
                <tr className="bg-slate-50/60"><td colSpan={5} className="px-4 py-1.5 text-xs font-medium text-slate-600">{g}</td></tr>
                {ks.map((k) => {
                  const xs = of(personId).filter((x) => x.type === k);
                  const annual = COVERAGE_ANNUAL.includes(k);
                  return [
                    <tr key={k} className="font-medium">
                      <td className="px-4 py-2">{label(k)}</td>
                      <td className="px-4 text-right tabular-nums">{byCcy(xs.map((x) => ({ amount: x.limit, currency: x.currency }))).map(([c, v]) => <div key={c}>{money(v, ccy(c), 0)}</div>)}</td>
                      <td className="px-4 text-right tabular-nums">{annual ? money(xs.reduce((t, x) => t + x.used, 0), undefined, 0) : ""}</td>
                      <td className="px-4 text-right tabular-nums">{annual ? money(xs.reduce((t, x) => t + Math.max(x.limit - x.used, 0), 0), undefined, 0) : ""}</td>
                      <td></td>
                    </tr>,
                    ...xs.map((x, n) => (
                      <tr key={`${k}${n}`} className="align-top text-slate-600">
                        <td className="py-1.5 pl-8 pr-4"><Link href={`/insurance/${x.policyId}`} className="hover:underline">{policy.get(x.policyId)?.name ?? "-"}</Link>
                          {(x.notes || x.fromPolicy) && <div className="text-xs text-slate-500">{x.fromPolicy ? "ทุนประกันของกรมธรรม์" : x.notes}</div>}</td>
                        <td className="px-4 text-right tabular-nums">{money(x.limit, ccy(x.currency), 0)}</td>
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
            {groups.map(([g, ks]) => (
              <tbody key={g} className="divide-y divide-slate-100 border-t border-slate-200">
                <tr className="bg-slate-50/60"><td colSpan={covPersons.length + 1} className="px-4 py-1.5 text-xs font-medium text-slate-600"><span className="sticky left-4 inline-block">{g}</span></td></tr>
                {ks.map((k) => (
                  <tr key={k} className="align-top">
                    <td className={`${STICKY} bg-white px-4 py-2`}>{label(k)}</td>
                    {covPersons.map((p) => {
                      const xs = of(p.id).filter((x) => x.type === k);
                      if (xs.length === 0) return <td key={p.id} className="px-4 text-right text-slate-300">-</td>;
                      const annual = COVERAGE_ANNUAL.includes(k);
                      const lim = xs.filter((x) => x.currency === "THB").reduce((t, x) => t + x.limit, 0);
                      const used = xs.reduce((t, x) => t + x.used, 0);
                      return (
                        <td key={p.id} className="px-4 py-2 text-right">
                          {byCcy(xs.map((x) => ({ amount: x.limit, currency: x.currency }))).map(([c, v]) => (
                            <div key={c}><ModalButton label={money(v, ccy(c), 0)} title={`${COVERAGE_LABEL[k]?.[0] ?? k} · ${p.name}`} className={LINK}>{detail(xs, annual)}</ModalButton></div>
                          ))}
                          {xs.length > 1 && <div className="text-xs text-slate-400">{xs.length} กรมธรรม์</div>}
                          {annual && used > 0 && <div className={`text-xs ${lim > 0 && used / lim >= 0.8 ? "text-red-700" : "text-slate-500"}`}>เหลือ {money(Math.max(lim - used, 0), undefined, 0)}</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table></div>
        )}
      </section>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <h2 className="px-4 pt-4 font-medium text-slate-900">เคลมปี {Number(year) + 543} · {who}</h2>
        <table className="mt-2 w-full min-w-[44rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">วันที่</th><th className="px-4">ผู้เอาประกัน</th><th className="px-4">กรมธรรม์ / ความคุ้มครอง</th>
              <th className="px-4 text-right">ยอดยื่น</th><th className="px-4 text-right">ได้รับ</th><th className="px-4">สถานะ</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {myClaims.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">ยังไม่มีเคลมในปีนี้</td></tr>}
            {myClaims.map((c) => (
              <tr key={c.id} className={`align-top ${live(c) ? "" : "text-slate-400"}`}>
                <td className="whitespace-nowrap px-4 py-2">{thDate(c.date)}</td>
                <td className="px-4">{c.personId ? pname.get(c.personId) : "-"}</td>
                <td className="px-4">{pol(c.policyId)}{c.coverageType && <span className="text-xs text-slate-500"> · {COVERAGE_LABEL[c.coverageType]?.[0] ?? c.coverageType}</span>}
                  {c.notes && <div className="text-xs text-slate-500">{c.notes}</div>}</td>
                <td className="px-4 text-right tabular-nums">{money(c.claimed, c.currency !== "THB" ? c.currency : undefined)}</td>
                <td className="px-4 text-right tabular-nums text-emerald-700">{c.received > 0 ? money(c.received, c.currency !== "THB" ? c.currency : undefined) : "-"}</td>
                <td className="px-4 text-xs">{CLAIM[c.status] ?? c.status}</td>
              </tr>
            ))}
          </tbody>
          {myClaims.length > 0 && <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium"><tr><td colSpan={3} className="px-4 py-2">รวม (THB · ไม่นับปฏิเสธ / ยกเลิก)</td>
            <td className="px-4 text-right tabular-nums">{money(myClaims.filter((c) => live(c) && c.currency === "THB").reduce((t, c) => t + c.claimed, 0))}</td>
            <td className="px-4 text-right tabular-nums text-emerald-700">{money(myClaims.filter((c) => live(c) && c.currency === "THB").reduce((t, c) => t + c.received, 0))}</td><td></td></tr></tfoot>}
        </table>
        <p className="px-4 pb-3 pt-2 text-xs text-slate-500">บันทึกเคลม: บันทึกค่ารักษาเป็นค่าใช้จ่าย (ติ๊ก &ldquo;จะได้เงินคืน&rdquo;) แล้วกด &ldquo;บันทึกเงินคืน&rdquo; เลือก &ldquo;เคลมใหม่&rdquo; ตามความคุ้มครอง
          {canWrite && <> · <Link href="/income-expenses?tab=expense" className="text-blue-700 hover:underline">ไปที่ค่าใช้จ่าย →</Link></>}</p>
      </section>
    </div>
  );
}
