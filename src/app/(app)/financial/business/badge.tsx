/** ตัวย่อบนป้าย: ตัวอักษรภาษาอังกฤษ / ตัวเลข 4 ตัวแรกของชื่อรายการ (ไม่มี = 2 ตัวแรก) */
export const initials = (name: string) => {
  const latin = name.replace(/[^A-Za-z0-9]/g, "");
  return (latin || name).slice(0, latin ? 4 : 2).toUpperCase();
};

/** ป้ายกิจการ: มีโลโก้ = แสดงโลโก้ · ไม่มี = กล่องสีกับตัวย่อ (แบบเดิม) */
export default function BusinessBadge({ logo, name, color, className = "h-9 w-11" }: {
  logo: string | null | undefined; name: string; color: string; className?: string;
}) {
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} alt={name} className={`${className} shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-0.5`} />;
  }
  return (
    <span className={`inline-flex ${className} shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold text-white`}
      style={{ background: color }}>{initials(name)}</span>
  );
}
