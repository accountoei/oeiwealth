import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { thDate, todayBangkok } from "@/lib/format";
import OverrideForm from "./OverrideForm";

const JOB_RESULT: Record<string, string> = { SUCCESS: "สำเร็จ", PARTIAL: "บางส่วน", FAILED: "ล้มเหลว", RUNNING: "กำลังทำงาน" };

export default async function SystemPage() {
  const me = await requireAppUser();
  const supabase = await createClient();
  const isAdmin = me.role === "ADMIN";
  const [{ data: family }, { data: fx }, { data: jobs }, { data: recent }] = await Promise.all([
    supabase.from("families").select("base_currency,go_live_date,system_status").maybeSingle(),
    supabase.from("v_fx_status").select("currency,latest_rate_date,rate_to_thb,source,is_override,age_days,is_stale").order("currency"),
    isAdmin
      ? supabase.from("system_job_runs").select("id,job_type,started_at,result,details").order("started_at", { ascending: false }).limit(10)
      : Promise.resolve({ data: [] as { id: number; job_type: string; started_at: string; result: string; details: unknown }[] }),
    supabase.from("fx_rates").select("rate_date,currency,rate_to_thb,source,override_reason").is("deleted_at", null)
      .in("currency", ["USD", "EUR", "GBP", "JPY", "SGD", "CNY"]).order("rate_date", { ascending: false }).limit(18),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">System</h1>
        <p className="text-sm text-slate-500">
          สกุลเงินหลัก {family?.base_currency} · Go-live {thDate(family?.go_live_date)} · {family?.system_status}
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">อัตราแลกเปลี่ยนของสกุลที่ใช้งาน</h2>
        <p className="mb-3 text-xs text-slate-500">
          ดึงจาก ธปท. (อัตราเฉลี่ยรายวัน) ทุกวัน 19:30 · การคำนวณใช้ Rate ล่าสุด <b>ก่อน</b> วันที่ของรายการ · Rate เก่ากว่า 5 วัน = FX_STALE (ปิดเดือนไม่ได้)
        </p>
        {(fx ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">ยังไม่มีทรัพย์สินที่เป็นเงินต่างประเทศ</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">สกุล</th><th>Rate ล่าสุด</th><th>วันที่</th><th>ที่มา</th><th>สถานะ</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(fx ?? []).map((r) => (
                <tr key={r.currency}>
                  <td className="py-1.5 font-medium">{r.currency}</td>
                  <td className="tabular-nums">{r.rate_to_thb ?? "-"}</td>
                  <td>{thDate(r.latest_rate_date)}</td>
                  <td>{r.source === "ADMIN_OVERRIDE" ? "ADMIN Override" : r.source ? "ธปท." : "-"}</td>
                  <td>{r.is_stale
                    ? <span className="text-red-600">ไม่มี / เก่าเกิน 5 วัน</span>
                    : <span className="text-emerald-700">ปกติ</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-slate-900">Rate ล่าสุดที่บันทึก (สกุลหลัก)</h2>
        {(recent ?? []).length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีข้อมูล — รอ FX Job รอบแรก</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">วันที่</th><th>สกุล</th><th>1 หน่วย = บาท</th><th>ที่มา</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(recent ?? []).map((r) => (
                <tr key={`${r.rate_date}-${r.currency}`}>
                  <td className="py-1.5">{thDate(r.rate_date)}</td><td>{r.currency}</td>
                  <td className="tabular-nums">{r.rate_to_thb}</td>
                  <td className="text-slate-500">{r.source === "ADMIN_OVERRIDE" ? `Override: ${r.override_reason}` : "ธปท."}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {isAdmin && (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-medium text-slate-900">FX Override (ADMIN)</h2>
            <p className="mb-3 text-xs text-slate-500">ใช้เฉพาะเมื่อ ธปท. ไม่มีข้อมูลหรือระบบดึงไม่สำเร็จ · ระบบดึงอัตโนมัติจะไม่เขียนทับค่าที่ Override · บันทึกใน Audit Log</p>
            <OverrideForm today={todayBangkok()} />
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-medium text-slate-900">ประวัติงานอัตโนมัติ (ล่าสุด 10 ครั้ง)</h2>
            {(jobs ?? []).length === 0 ? <p className="text-sm text-slate-500">ยังไม่มี</p> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">เวลา</th><th>งาน</th><th>ผล</th><th>จำนวน</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {(jobs ?? []).map((j) => (
                    <tr key={j.id}>
                      <td className="py-1.5">{new Date(j.started_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</td>
                      <td>{j.job_type}</td><td>{JOB_RESULT[j.result] ?? j.result}</td>
                      <td>{(j.details as { rows?: number } | null)?.rows ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
