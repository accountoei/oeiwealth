"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ลิงก์เชิญ / ลิงก์เข้าระบบครั้งแรก (สร้างโดย ADMIN ที่หน้า Family & Users)
// ยืนยันลิงก์เมื่อกดปุ่มเท่านั้น — กันแอปแชตที่เปิดดูตัวอย่างลิงก์ (Preview) ใช้ลิงก์หมดก่อนผู้รับ
function AcceptForm() {
  const params = useSearchParams();
  const supabase = createClient();
  const tokenHash = params.get("token_hash") ?? "";
  const type = params.get("type") === "invite" ? "invite" : "email";
  const [step, setStep] = useState<"start" | "password">("start");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true); setError(null);
    await supabase.auth.signOut();                       // กันใช้ Session ของคนอื่นที่ค้างในเครื่อง
    const { error: e } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    setBusy(false);
    if (e) {
      setError("ลิงก์หมดอายุหรือถูกใช้ไปแล้ว — ขอให้ผู้ดูแลระบบสร้างลิงก์ใหม่");
      return;
    }
    setStep("password");
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 10) return setError("รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร");
    if (password !== confirm) return setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
    setBusy(true); setError(null);
    const { error: e1 } = await supabase.auth.updateUser({ password });
    if (e1) { setBusy(false); return setError(`ตั้งรหัสผ่านไม่สำเร็จ: ${e1.message}`); }
    const { error: e2 } = await supabase.rpc("record_login");
    if (e2) {
      await supabase.auth.signOut();
      setBusy(false);
      return setError("บัญชีนี้ไม่มีสิทธิ์ใช้งาน หรือถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ");
    }
    window.location.href = "/";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Family Wealth Vault</h1>
          <p className="text-sm text-slate-500">{step === "start" ? "ยืนยันคำเชิญเข้าใช้ระบบ" : "ตั้งรหัสผ่านของคุณ"}</p>
        </div>
        {!tokenHash ? (
          <p className="text-sm text-red-600">ลิงก์ไม่ถูกต้อง กรุณาเปิดจากลิงก์ที่ได้รับ</p>
        ) : step === "start" ? (
          <>
            <p className="text-sm text-slate-600">กดปุ่มด้านล่างเพื่อยืนยันตัวตน แล้วตั้งรหัสผ่านสำหรับเข้าระบบ</p>
            <button onClick={verify} disabled={busy}
              className="w-full rounded-md bg-slate-900 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              {busy ? "กำลังตรวจสอบ…" : "ยืนยันและตั้งรหัสผ่าน"}
            </button>
          </>
        ) : (
          <form onSubmit={savePassword} className="space-y-4">
            <label className="block text-sm"><span className="text-slate-700">รหัสผ่านใหม่ (อย่างน้อย 10 ตัว)</span>
              <input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
            </label>
            <label className="block text-sm"><span className="text-slate-700">ยืนยันรหัสผ่าน</span>
              <input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
            </label>
            <button disabled={busy} className="w-full rounded-md bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50">
              {busy ? "กำลังบันทึก…" : "บันทึกรหัสผ่านและเข้าระบบ"}
            </button>
          </form>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <p className="text-xs text-slate-400">ผู้ดูแลระบบ (ADMIN) จะต้องตั้ง MFA ด้วยแอป Authenticator ในขั้นถัดไป</p>
      </div>
    </main>
  );
}

export default function AcceptPage() {
  return <Suspense><AcceptForm /></Suspense>;
}
