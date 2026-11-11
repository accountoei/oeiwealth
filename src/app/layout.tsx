import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans-thai/400.css";
import "@fontsource/ibm-plex-sans-thai/500.css";
import "@fontsource/ibm-plex-sans-thai/600.css";
import "@fontsource/ibm-plex-sans-thai/700.css";
import "./globals.css";
import NumberInputs from "@/components/NumberInputs";
import SelectEnhancer from "@/components/SelectEnhancer";
import ScrollCue from "@/components/ScrollCue";
import DateInputs from "@/components/DateInputs";

export const metadata: Metadata = {
  // ชื่อแท็บเบราว์เซอร์: แต่ละหน้าใส่ชื่อของตัวเอง (export const metadata / generateMetadata) → "ชื่อหน้า · Family Wealth Vault"
  title: { default: "Family Wealth Vault", template: "%s · Family Wealth Vault" },
  description: "ระบบบันทึกสินทรัพย์และหนี้สินของครอบครัว",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="antialiased text-slate-900">{children}<NumberInputs /><DateInputs /><SelectEnhancer /><ScrollCue /></body>
    </html>
  );
}
