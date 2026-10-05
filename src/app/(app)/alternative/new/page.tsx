import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { addDays, todayBangkok } from "@/lib/format";
import NewAlternativeForm from "./NewAlternativeForm";

export default async function NewAlternativePage() {
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: family }, { data: persons }, { data: cats }] = await Promise.all([
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("created_at"),
    supabase.from("asset_categories").select("id,category_name,family_id").is("deleted_at", null).eq("active", true).order("family_id", { nullsFirst: true }).order("category_name"),
  ]);
  if (me.role === "VIEWER") return <p className="text-sm text-slate-600">สิทธิ์ผู้ดูเพิ่มรายการไม่ได้</p>;
  if (!family) return <p className="text-sm text-red-600">ไม่พบข้อมูลครอบครัว</p>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">เพิ่มสินทรัพย์อื่น</h1>
        <p className="text-sm text-slate-500">ทอง เครื่องประดับ นาฬิกา ของสะสม คริปโต ฯลฯ · มูลค่าประเมินเอง (แนะนำทุก 90 วัน)</p>
      </div>
      <NewAlternativeForm persons={persons ?? []} categories={(cats ?? []).map((c) => ({ id: c.id, name: c.category_name }))}
        goLive={family.go_live_date} openingDate={addDays(family.go_live_date, -1)} today={todayBangkok()}
        isSetup={family.system_status === "SETUP"} isAdmin={me.role === "ADMIN"} />
    </div>
  );
}
