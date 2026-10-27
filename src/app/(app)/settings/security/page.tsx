import { redirect } from "next/navigation";

// Security ย้ายไปอยู่ต่อจากผู้ใช้ในแท็บ User & Security (ลิงก์เดิมยังใช้ได้)
export default async function OldSecurityPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const qs = new URLSearchParams(await searchParams).toString();
  redirect(`/settings/family-users${qs ? `?${qs}` : ""}#security`);
}
