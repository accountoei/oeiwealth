"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "loading" | "enroll" | "verify";

/** MFA (TOTP): ตั้งค่าครั้งแรกด้วย QR Code หรือยืนยันรหัส 6 หลักทุกครั้งที่เข้าระบบ */
export default function MfaPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>("loading");
  const [factorId, setFactorId] = useState<string>("");
  const [qr, setQr] = useState<string>("");
  const [secret, setSecret] = useState<string>("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) { setError(listError.message); return; }
      const verifiedTotp = data.totp.find((f) => f.status === "verified");
      if (verifiedTotp) {
        setFactorId(verifiedTotp.id);
        setMode("verify");
        return;
      }
      // ลบ Factor ที่ตั้งค้างไว้แต่ยังไม่ยืนยัน แล้วเริ่มใหม่
      const all = (data.all ?? []) as { id: string; status: string }[];
      for (const f of all.filter((f) => f.status !== "verified")) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
      });
      if (enrollError) { setError(enrollError.message); return; }
      setFactorId(enrolled.id);
      setQr(enrolled.totp.qr_code);
      setSecret(enrolled.totp.secret);
      setMode("enroll");
    })();
  }, [supabase]);

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (verifyError) {
      setError("รหัสไม่ถูกต้องหรือหมดเวลา ลองใหม่อีกครั้ง");
      setBusy(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  async function onSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <form onSubmit={onVerify} className="w-full max-w-sm bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">ยืนยันตัวตน 2 ขั้นตอน</h1>
        {mode === "loading" && <p className="text-sm text-slate-500">กำลังโหลด…</p>}
        {mode === "enroll" && (
          <div className="space-y-3 text-sm text-slate-700">
            <p>สแกน QR Code ด้วยแอป Authenticator (เช่น Google Authenticator, Microsoft Authenticator, 1Password) แล้วกรอกรหัส 6 หลัก</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qr && <img src={qr} alt="QR Code สำหรับตั้งค่า MFA" className="mx-auto w-48 h-48" />}
            <p className="text-xs text-slate-500 break-all">สแกนไม่ได้? ใส่รหัสนี้ในแอปแทน: <code>{secret}</code></p>
          </div>
        )}
        {mode === "verify" && <p className="text-sm text-slate-700">กรอกรหัส 6 หลักจากแอป Authenticator</p>}
        {mode !== "loading" && (
          <>
            <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-center tracking-widest text-lg" />
            <button type="submit" disabled={busy || code.length !== 6}
              className="w-full rounded-md bg-blue-600 text-white py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {busy ? "กำลังตรวจสอบ…" : "ยืนยัน"}
            </button>
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="button" onClick={onSignOut} className="w-full text-xs text-slate-500 hover:underline">ออกจากระบบ</button>
      </form>
    </main>
  );
}
