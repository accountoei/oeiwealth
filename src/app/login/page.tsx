"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (params.get("error") === "no_access") {
      supabase.auth.signOut();
      setError("บัญชีนี้ไม่มีสิทธิ์ใช้งาน หรือถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ");
    }
  }, [params, supabase]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) {
      setError("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
      setBusy(false);
      return;
    }
    // INVITED → ACTIVE, บันทึก LOGIN และปฏิเสธบัญชีที่ถูกปิด (ตรวจที่ฐานข้อมูล)
    const { error: loginError } = await supabase.rpc("record_login");
    if (loginError) {
      await supabase.auth.signOut();
      setError("บัญชีนี้ไม่มีสิทธิ์ใช้งาน หรือถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ");
      setBusy(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Family Wealth Vault</h1>
          <p className="text-sm text-slate-500">เข้าสู่ระบบ</p>
        </div>
        <label className="block text-sm">
          <span className="text-slate-700">อีเมล</span>
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400" />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">รหัสผ่าน</span>
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400" />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy}
          className="w-full rounded-md bg-blue-600 text-white py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
        </button>
        <p className="text-xs text-slate-400">ระบบนี้เปิดให้เฉพาะผู้ที่ได้รับเชิญเท่านั้น · ลืมรหัสผ่านหรือทำมือถือ (MFA) หาย ติดต่อผู้ดูแลระบบเพื่อขอลิงก์ตั้งรหัสใหม่</p>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
