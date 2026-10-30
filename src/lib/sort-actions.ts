"use server";

import { revalidatePath } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";

function refresh(form: FormData) {
  String(form.get("paths") ?? "").split(",").filter(Boolean).forEach((p) => revalidatePath(p));
}

/** จัดลำดับ: สลับกับรายการข้าง ๆ ที่มองเห็น (มีผลทันที) */
export async function moveSort(form: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("swap_sort_order", { p_table: String(form.get("table")), p_a: String(form.get("id")), p_b: String(form.get("other")) });
  refresh(form);
}

/** จัดลำดับรายการผลตรวจสุขภาพของสมาชิก */
export async function moveHealthMetric(form: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("move_health_metric", {
    p_person_id: String(form.get("person_id")), p_metric: String(form.get("metric")), p_neighbor: String(form.get("other")),
  });
  refresh(form);
}
