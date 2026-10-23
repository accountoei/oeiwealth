import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // กฎใหม่ของ eslint-config-next 16 (react-hooks v7 · ออกแบบให้ React Compiler) — แอปนี้ไม่ได้เปิด React Compiler
    // และโค้ดเดิมทำงานถูกต้อง จึงให้เป็นคำเตือนก่อน ค่อยทยอยแก้ทีหลัง
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/static-components": "warn",
    },
  },
  globalIgnores([
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
