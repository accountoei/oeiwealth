import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { addDays, todayBangkok } from "@/lib/format";
import NewAccountForm from "./NewAccountForm";

export default async function NewAccountPage() {
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: family }, { data: persons }] = await Promise.all([
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("created_at"),
  ]);
  if (me.role === "VIEWER") return <p className="text-sm text-slate-600">สิทธิ์ผู้ดูเพิ่มบัญชีไม่ได้</p>;
  if (!family) return <p className="text-sm text-red-600">ไม่พบข้อมูลครอบครัว</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">เพิ่มบัญชีเงินฝาก</h1>
        <p className="text-sm text-slate-500">สร้างบัญชีพร้อมยอดคงเหลือแรกและเจ้าของบัญชีในครั้งเดียว</p>
      </div>
      <NewAccountForm
        persons={persons ?? []}
        goLive={family.go_live_date}
        openingDate={addDays(family.go_live_date, -1)}
        today={todayBangkok()}
        isSetup={family.system_status === "SETUP"}
        isAdmin={me.role === "ADMIN"}
      />
    </div>
  );
}
