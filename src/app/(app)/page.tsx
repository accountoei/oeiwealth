import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const STATUS_LABEL: Record<string, string> = { SETUP: "กำลังตั้งค่า (SETUP)", LIVE: "ใช้งานจริง (LIVE)" };

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: family } = await supabase.from("families").select("name,go_live_date,system_status").maybeSingle();
  const { data: readiness } = await supabase.from("v_go_live_readiness").select("status");
  const count = (s: string) => (readiness ?? []).filter((r) => r.status === s).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{family?.name ?? "Dashboard"}</h1>
        <p className="text-sm text-slate-500">
          Go-live {family?.go_live_date ?? "-"} · {STATUS_LABEL[family?.system_status ?? ""] ?? "-"}
        </p>
      </div>
      {family?.system_status === "SETUP" && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="font-medium text-amber-900">ระบบยังอยู่ในช่วงตั้งค่า</h2>
          <p className="mt-1 text-sm text-amber-800">
            ความพร้อมก่อน Go-live: พร้อม {count("READY")} · ควรตรวจ {count("WARN")} · ยังขาด {count("MISSING")} รายการ
          </p>
          <p className="mt-2 text-sm text-amber-800">
            เริ่มจากเพิ่มสมาชิกครอบครัวที่ <Link className="underline" href="/settings/family-users">Family &amp; Users</Link>
          </p>
        </section>
      )}
      <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
        ภาพรวม Net Worth จะแสดงที่นี่เมื่อมีข้อมูลสินทรัพย์
      </section>
    </div>
  );
}
