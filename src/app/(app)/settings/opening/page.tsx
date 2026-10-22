import { redirect } from "next/navigation";

// Opening Setup ย้ายไปเป็นแท็บที่สองของหน้า System (ลิงก์เดิมยังใช้ได้)
export default function OpeningSetupPage() {
  redirect("/settings/system?tab=opening");
}
