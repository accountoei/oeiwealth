import { redirect } from "next/navigation";

// Month Closing ย้ายไปเป็นแท็บแรกของ Settings (ลิงก์เดิมยังใช้ได้)
export default async function OldMonthClosingPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const qs = new URLSearchParams(await searchParams).toString();
  redirect(`/settings/month-closing${qs ? `?${qs}` : ""}`);
}
