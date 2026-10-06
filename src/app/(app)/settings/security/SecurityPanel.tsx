"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Factor = { id: string; friendly_name?: string; status: string; created_at: string };
const box = "space-y-3 rounded-xl border border-slate-200 bg-white p-5";
const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50";

export default function SecurityPanel({ isAdmin }: { isAdmin: boolean }) {
  const supabase = createClient();
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok?: string; error?: string }>({});
  const [factors, setFactors] = useState<Factor[]>([]);
  const [mfaMsg, setMfaMsg] = useState<{ ok?: string; error?: string }>({});
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(((data?.all ?? []) as Factor[]).filter((f) => f.status === "verified"));
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 10) return setPwMsg({ error: "รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร" });
    if (pw !== pw2) return setPwMsg({ error: "รหัสผ่านทั้งสองช่องไม่ตรงกัน" });
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setPwMsg({ error: `เปลี่ยนไม่สำเร็จ: ${error.message}` });
    setPw(""); setPw2(""); setPwMsg({ ok: "เปลี่ยนรหัสผ่านแล้ว" });
  }

  async function startEnroll() {
    setMfaMsg({});
    const { data: all } = await supabase.auth.mfa.listFactors();
    for (const f of ((all?.all ?? []) as Factor[]).filter((f) => f.status !== "verified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `อุปกรณ์ ${new Date().toISOString().slice(0, 16)}` });
    if (error) return setMfaMsg({ error: error.message });
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }
  async function verifyEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!enroll) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.id, code: code.trim() });
    setBusy(false);
    if (error) return setMfaMsg({ error: "รหัสไม่ถูกต้องหรือหมดเวลา" });
    setEnroll(null); setCode(""); setMfaMsg({ ok: "เพิ่มอุปกรณ์ MFA แล้ว" }); load();
  }
  async function remove(id: string) {
    if (isAdmin && factors.length <= 1) return setMfaMsg({ error: "ผู้ดูแลระบบต้องมี MFA อย่างน้อย 1 อุปกรณ์ — เพิ่มอุปกรณ์ใหม่ก่อนแล้วค่อยลบอันเก่า" });
    if (!confirm("ลบอุปกรณ์ MFA นี้?")) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) return setMfaMsg({ error: error.message });
    setMfaMsg({ ok: "ลบแล้ว" }); load();
  }
  async function signOutAll() {
    if (!confirm("ออกจากระบบทุกอุปกรณ์ (รวมเครื่องนี้)?")) return;
    await supabase.auth.signOut({ scope: "global" });
    window.location.href = "/login";
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form onSubmit={changePassword} className={box}>
        <h2 className="font-medium text-slate-900">เปลี่ยนรหัสผ่าน</h2>
        <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="รหัสผ่านใหม่ (อย่างน้อย 10 ตัว)" className={`block w-full ${input}`} />
        <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="ยืนยันรหัสผ่านใหม่" className={`block w-full ${input}`} />
        <button disabled={busy} className={btn}>เปลี่ยนรหัสผ่าน</button>
        {pwMsg.error && <p className="text-sm text-red-600">{pwMsg.error}</p>}
        {pwMsg.ok && <p className="text-sm text-emerald-700">{pwMsg.ok}</p>}
      </form>

      <div className={box}>
        <h2 className="font-medium text-slate-900">MFA (แอป Authenticator)</h2>
        {factors.length === 0 ? <p className="text-sm text-slate-500">ยังไม่ได้ตั้ง MFA{isAdmin ? "" : " (ไม่บังคับสำหรับสิทธิ์นี้ แต่แนะนำ)"}</p> : (
          <ul className="space-y-1 text-sm">
            {factors.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2">
                <span>{f.friendly_name ?? "Authenticator"} <span className="text-xs text-slate-500">ตั้งเมื่อ {new Date(f.created_at).toLocaleDateString("th-TH")}</span></span>
                <button onClick={() => remove(f.id)} className="text-xs text-red-600 underline">ลบ</button>
              </li>
            ))}
          </ul>
        )}
        {!enroll ? (
          <button onClick={startEnroll} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">+ เพิ่มอุปกรณ์ (เช่น เปลี่ยนมือถือ)</button>
        ) : (
          <form onSubmit={verifyEnroll} className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enroll.qr} alt="QR Code" className="h-44 w-44 rounded border border-slate-200" />
            <p className="break-all text-xs text-slate-500">ถ้าสแกนไม่ได้ ใส่รหัสนี้ในแอป: {enroll.secret}</p>
            <div className="flex gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="รหัส 6 หลัก" className={input} />
              <button disabled={busy} className={btn}>ยืนยัน</button>
              <button type="button" onClick={() => setEnroll(null)} className="text-sm text-slate-500">ยกเลิก</button>
            </div>
          </form>
        )}
        {mfaMsg.error && <p className="text-sm text-red-600">{mfaMsg.error}</p>}
        {mfaMsg.ok && <p className="text-sm text-emerald-700">{mfaMsg.ok}</p>}
        <p className="text-xs text-slate-500">เปลี่ยนมือถือ: เพิ่มอุปกรณ์ใหม่ก่อน แล้วค่อยลบอันเก่า · ทำมือถือหาย: ให้ผู้ดูแลระบบกด &ldquo;รีเซ็ต MFA&rdquo; ที่หน้า Family &amp; Users</p>
      </div>

      <div className={box}>
        <h2 className="font-medium text-slate-900">อุปกรณ์ที่เข้าระบบ</h2>
        <p className="text-sm text-slate-600">ถ้าสงสัยว่ามีคนอื่นใช้บัญชี ให้เปลี่ยนรหัสผ่าน แล้วออกจากระบบทุกอุปกรณ์</p>
        <button onClick={signOutAll} className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50">ออกจากระบบทุกอุปกรณ์</button>
      </div>
    </div>
  );
}
