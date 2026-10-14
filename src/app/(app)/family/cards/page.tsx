import { redirect } from "next/navigation";

/** หน้าเดิม: บัตรเครดิตย้ายไป Liabilities · สมาชิกภาพ / แต้มย้ายไป /family/memberships */
export default function OldCardsPage() {
  redirect("/liabilities#cards");
}
