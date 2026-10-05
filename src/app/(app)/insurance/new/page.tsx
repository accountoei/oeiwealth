import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { addDays, todayBangkok } from "@/lib/format";
import NewPolicyForm from "./NewPolicyForm";

export default async function NewPolicyPage() {
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: family }, { data: persons }, { data: assets }] = await Promise.all([
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("created_at"),
    supabase.from("v_assets_active").select("id,name").in("asset_group", ["PROPERTY", "ALTERNATIVE"]).eq("status", "ACTIVE").order("name"),
  ]);
  if (me.role === "VIEWER") return <p className="text-sm text-slate-600">สิทธิ์ผู้ดูเพิ่มรายการไม่ได้</p>;
  if (!family) return <p className="text-sm text-red-600">ไม่พบข้อมูลครอบครัว</p>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">เพิ่มกรมธรรม์ประกัน</h1>
        <p className="text-sm text-slate-500">ประกันชีวิต / สุขภาพ / อุบัติเหตุ / ทรัพย์สิน · กรมธรรม์ที่มีมูลค่าเวนคืนนับเป็นสินทรัพย์</p>
      </div>
      <NewPolicyForm persons={persons ?? []} assets={assets ?? []} goLive={family.go_live_date}
        openingDate={addDays(family.go_live_date, -1)} today={todayBangkok()}
        isSetup={family.system_status === "SETUP"} isAdmin={me.role === "ADMIN"} />
    </div>
  );
}
