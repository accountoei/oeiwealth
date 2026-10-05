import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans-thai/400.css";
import "@fontsource/ibm-plex-sans-thai/500.css";
import "@fontsource/ibm-plex-sans-thai/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Family Wealth Vault",
  description: "ระบบบันทึกทรัพย์สินและหนี้สินของครอบครัว",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="antialiased text-slate-900">{children}</body>
    </html>
  );
}
