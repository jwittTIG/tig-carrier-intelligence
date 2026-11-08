import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Pages, route handlers, server actions and components never touch the database
    // directly: they call services in @/server/services, which check permissions and audit.
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{ name: "@prisma/client", message: "Call a service in @/server/services instead." }],
        patterns: [
          { group: ["@/server/db", "@/server/db/*", "**/server/db/*"], message: "Call a service in @/server/services instead." },
          { group: ["@/generated/prisma/client"], message: "Call a service in @/server/services instead." },
        ],
      }],
    },
  },
  globalIgnores([
    ".next/**",
    ".next-e2e/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    ".data/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
