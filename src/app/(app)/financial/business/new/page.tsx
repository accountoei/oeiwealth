import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { addDays, todayBangkok } from "@/lib/format";
import NewBusinessForm from "./NewBusinessForm";

export default async function NewBusinessPage() {
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: family }, { data: persons }] = await Promise.all([
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("created_at"),
  ]);
  if (me.role === "VIEWER") return <p className="text-sm text-slate-600">สิทธิ์ผู้ดูเพิ่มรายการไม่ได้</p>;
  if (!family) return <p className="text-sm text-red-600">ไม่พบข้อมูลครอบครัว</p>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">เพิ่มธุรกิจ / หุ้นนอกตลาด</h1>
        <p className="text-sm text-slate-500">บริษัทของครอบครัวหรือหุ้นที่ไม่ได้ซื้อขายในตลาด · มูลค่าประเมินเอง</p>
      </div>
      <NewBusinessForm persons={persons ?? []} goLive={family.go_live_date} openingDate={addDays(family.go_live_date, -1)}
        today={todayBangkok()} isSetup={family.system_status === "SETUP"} isAdmin={me.role === "ADMIN"} />
    </div>
  );
}
