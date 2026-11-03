import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { COVERAGE_LABEL, INS_TYPE, money, thDate, thDateLong, todayBangkok } from "@/lib/format";
import PrintShell, { type PrintSection } from "../loan/[id]/print-shell";

export const metadata = { title: "พิมพ์สรุปประกันสำหรับโรงพยาบาล" };

const TYPE = Object.fromEntries(INS_TYPE);
const ORDER = ["HEALTH", "ACCIDENT", "LIFE"];

/**
 * สรุปประกันสำหรับยื่นโรงพยาบาล (ตกลง 3 พ.ย. 2026) — หน้าละ 1 คน · ขนาด A4
 *   กรมธรรม์ที่มีผล (สุขภาพ → อุบัติเหตุ → ชีวิต · ไม่รวมประกันทรัพย์สิน) + ความคุ้มครอง / วงเงิน / หมายเหตุ
 *   ?p= = เฉพาะคนนั้น · ไม่ระบุ = ทุกคนที่มีกรมธรรม์ที่มีผล (เลือกติ๊กได้ในแถบบน)
 *   เบอร์ติดต่อบริษัทประกันยังไม่มีในระบบ → เว้นช่องให้เขียน
 */
export default async function PrintInsurancePage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  await requireAppUser();
  const supabase = await createClient();
  const today = todayBangkok();
  const [{ data: people }, { data: pols }, { data: covs }] = await Promise.all([
    supabase.from("persons").select("id,name,title_prefix,full_name_th,birth_date,status").is("deleted_at", null).order("sort_order").order("created_at"),
    supabase.from("insurance_policies").select("id,insurance_type,person_id,insurer,policy_no,start_date,end_date,insured_amount,insured_amount_currency,notes")
      .eq("status", "ACTIVE").is("deleted_at", null).neq("insurance_type", "PROPERTY").order("insurer"),
    supabase.from("insurance_coverages").select("policy_id,coverage_type,limit_amount,currency,notes").is("deleted_at", null),
  ]);
  const order = Object.keys(COVERAGE_LABEL);
  const sections: PrintSection[] = (people ?? []).filter((x) => x.status !== "DECEASED" && (pols ?? []).some((r) => r.person_id === x.id)).map((x) => {
    const mine = (pols ?? []).filter((r) => r.person_id === x.id)
      .sort((a, b) => ORDER.indexOf(a.insurance_type) - ORDER.indexOf(b.insurance_type));
    const age = x.birth_date ? Math.floor((Number(today.replaceAll("-", "")) - Number(String(x.birth_date).replaceAll("-", ""))) / 10000) : null;
    const name = x.full_name_th ? `${x.title_prefix ?? ""}${x.full_name_th}` : x.name;
    return {
      key: x.id, label: x.name, on: !p || p === x.id,
      node: (
        <div className="space-y-5 text-[13px] leading-relaxed text-slate-900">
          <div className="flex items-start justify-between border-b-2 border-slate-800 pb-2">
            <div>
              <h1 className="text-lg font-semibold">สรุปประกันสำหรับยื่นโรงพยาบาล</h1>
              <div className="mt-1 text-base">{name}</div>
              {x.birth_date && <div className="text-slate-600">วันเกิด {thDateLong(x.birth_date)}{age != null && ` · อายุ ${age} ปี`}</div>}
            </div>
            <div className="text-right text-xs text-slate-500">ข้อมูล ณ {thDateLong(today)}</div>
          </div>
          {mine.map((r) => {
            const cs = (covs ?? []).filter((c) => c.policy_id === r.id).sort((a, b) => order.indexOf(a.coverage_type) - order.indexOf(b.coverage_type));
            return (
              <div key={r.id} className="break-inside-avoid rounded border border-slate-300 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-semibold">{r.insurer} <span className="font-normal text-slate-600">· {TYPE[r.insurance_type] ?? r.insurance_type}</span></div>
                  <div>เลขกรมธรรม์ <span className="font-semibold tabular-nums">{r.policy_no ?? "................................"}</span></div>
                </div>
                <div className="text-slate-600">คุ้มครอง {thDate(r.start_date)} – {thDate(r.end_date)}
                  {r.insured_amount != null && Number(r.insured_amount) > 0 && <> · ทุนประกัน {money(r.insured_amount, r.insured_amount_currency ?? undefined, 0)}</>}</div>
                {cs.length > 0 ? (
                  <table className="mt-2 w-full">
                    <thead className="border-b border-slate-300 text-left text-xs text-slate-500"><tr><th className="py-1">ความคุ้มครอง</th><th className="text-right">วงเงิน</th><th className="pl-4">หมายเหตุ</th></tr></thead>
                    <tbody className="divide-y divide-slate-200">
                      {cs.map((c, n) => (
                        <tr key={n} className="align-top">
                          <td className="py-1">{COVERAGE_LABEL[c.coverage_type]?.[0] ?? c.coverage_type}{COVERAGE_LABEL[c.coverage_type]?.[1] && ` (${COVERAGE_LABEL[c.coverage_type][1]})`}</td>
                          <td className="whitespace-nowrap text-right tabular-nums">{money(c.limit_amount, c.currency, 0)}</td>
                          <td className="pl-4 text-slate-600">{c.notes ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <div className="mt-1 text-xs text-slate-500">ยังไม่ได้กรอกรายละเอียดความคุ้มครองในระบบ</div>}
                {r.notes && <div className="mt-2 whitespace-pre-line text-xs text-slate-600">หมายเหตุ: {r.notes}</div>}
                <div className="mt-2 text-xs text-slate-500">โทรติดต่อบริษัท / Call Center: ..................................................</div>
              </div>
            );
          })}
          <p className="text-xs text-slate-500">วงเงินตามข้อมูลที่บันทึกไว้ในระบบ · โปรดตรวจสอบกับเล่มกรมธรรม์ / บัตรประกันก่อนใช้สิทธิ์</p>
        </div>
      ),
    };
  });
  return <PrintShell back={`/insurance?tab=coverage${p ? `&p=${p}` : ""}`} sections={sections}
    warn={sections.length === 0 ? ["ยังไม่มีกรมธรรม์ที่มีผล"] : undefined} />;
}
