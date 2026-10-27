import { redirect } from "next/navigation";

// Documents ย้ายไปเป็นแท็บของ Family & Documents (ลิงก์เดิมยังใช้ได้ · รวมถึงลิงก์กลับจาก Google หลังเชื่อม Drive)
export default async function OldDocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const qs = new URLSearchParams(await searchParams).toString();
  redirect(`/family/documents${qs ? `?${qs}` : ""}`);
}
