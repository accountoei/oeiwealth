"use client";

import { useRouter } from "next/navigation";

export default function PersonPicker({ persons, value }: { persons: { id: string; name: string }[]; value: string }) {
  const router = useRouter();
  return (
    <select value={value} onChange={(e) => router.push(`/family/health?p=${e.target.value}`)}
      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
      {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}
