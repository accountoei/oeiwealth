import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { addDays, todayBangkok } from "@/lib/format";
import NewLiabilityForm from "./NewLiabilityForm";
import { InfoTip } from "@/components/HeaderBar";

export default async function NewLiabilityPage() {
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: family }, { data: persons }, { data: assets }, { data: biz }] = await Promise.all([
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    supabase.from("v_assets_active").select("id,name,asset_group").eq("status", "ACTIVE").order("name"),
    supabase.from("private_business_details").select("asset_id,company_name").is("deleted_at", null).order("company_name"),
  ]);
  if (me.role === "VIEWER") return <p className="text-sm text-slate-600">สิทธิ์ผู้ดูเพิ่มรายการไม่ได้</p>;
  if (!family) return <p className="text-sm text-red-600">ไม่พบข้อมูลครอบครัว</p>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-1 text-2xl font-semibold text-slate-900">เพิ่มเงินกู้ / หนี้สิน <InfoTip label="คำอธิบาย">เงินกู้ · วงเงินสินเชื่อ · บัตรเครดิต (เลือกที่ช่องประเภท) · เงินประกันการเช่ามาจากสัญญาเช่าอัตโนมัติ</InfoTip></h1>
      </div>
      <NewLiabilityForm persons={persons ?? []} assets={assets ?? []} goLive={family.go_live_date}
        openingDate={addDays(family.go_live_date, -1)} today={todayBangkok()}
        isSetup={family.system_status === "SETUP"} isAdmin={me.role === "ADMIN"}
        businesses={(biz ?? []).map((b) => ({ id: b.asset_id, name: b.company_name }))}
        cardDate={family.system_status === "SETUP" ? addDays(family.go_live_date, -1) : todayBangkok()} />
    </div>
  );
}
