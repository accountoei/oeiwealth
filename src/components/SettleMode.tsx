"use client";

// ตัวเลือก "เงินเข้า / ออก ที่ไหน" ของรายการในพอร์ตลงทุน (ใช้ชื่อเดียวกันทุกฟอร์ม)
//   cash = บัญชีเงินฝากในพอร์ตนี้ · bank = บัญชีธนาคารในหน้า Cash & Bank Accounts
export function SettleModeRadios({ mode, setMode, portfolioName, out = false, className = "flex flex-wrap gap-4" }: {
  mode: string; setMode: (v: string) => void; portfolioName: string; out?: boolean; className?: string;
}) {
  const pf = portfolioName ? ` (${portfolioName})` : "";
  return (
    <div className={className}>
      <label className="flex items-center gap-2">
        <input type="radio" name="settle_mode" value="cash" checked={mode === "cash"} onChange={() => setMode("cash")} />
        {out ? `จ่ายจากบัญชีในพอร์ต${pf}` : `เข้าบัญชีในพอร์ต${pf}`}
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" name="settle_mode" value="bank" checked={mode === "bank"} onChange={() => setMode("bank")} />
        {out ? "โอนจากบัญชีธนาคาร (Cash & Bank Accounts)" : "โอนออกไปบัญชีธนาคาร (Cash & Bank Accounts)"}
      </label>
    </div>
  );
}
