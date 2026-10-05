import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { addDays, todayBangkok } from "@/lib/format";
import NewLiabilityForm from "./NewLiabilityForm";

export default async function NewLiabilityPage() {
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: family }, { data: persons }, { data: assets }] = await Promise.all([
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("created_at"),
    supabase.from("v_assets_active").select("id,name,asset_group").eq("status", "ACTIVE").order("name"),
  ]);
  if (me.role === "VIEWER") return <p className="text-sm text-slate-600">สิทธิ์ผู้ดูเพิ่มรายการไม่ได้</p>;
  if (!family) return <p className="text-sm text-red-600">ไม่พบข้อมูลครอบครัว</p>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">เพิ่มเงินกู้ / หนี้สิน</h1>
        <p className="text-sm text-slate-500">บัตรเครดิตเพิ่มที่หน้า Cards · เงินประกันการเช่ามาจากสัญญาเช่าอัตโนมัติ</p>
      </div>
      <NewLiabilityForm persons={persons ?? []} assets={assets ?? []} goLive={family.go_live_date}
        openingDate={addDays(family.go_live_date, -1)} today={todayBangkok()}
        isSetup={family.system_status === "SETUP"} isAdmin={me.role === "ADMIN"} />
    </div>
  );
}
