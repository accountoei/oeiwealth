import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import DocViewer from "./viewer";

/** หน้าดูเอกสารเต็มจอ (เปิดจากปุ่ม "เปิด") — ไฟล์โหลดผ่าน Edge Function "drive" ที่ตรวจสิทธิ์ + บันทึก Audit */
export default async function ViewDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAppUser();
  const supabase = await createClient();
  const { data: d } = await supabase.from("documents").select("id,title,mime_type").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!d) notFound();
  return <DocViewer id={d.id} title={d.title} mime={d.mime_type} />;
}
