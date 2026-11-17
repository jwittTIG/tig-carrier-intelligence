/**
 * Theme: light (the default) or dark, chosen with the toggle in the top bar and saved in this
 * browser (a cookie). Colors are TIG navy, orange and white, defined in src/app/globals.css.
 * (The per-person accent color picker was retired in the 2026-11-11 redesign.)
 */
export const MODE_COOKIE = "tci-mode";
export type Mode = "light" | "dark";
export const modeOf = (v: string | undefined | null): Mode => (v === "dark" ? "dark" : "light");

/** Sidebar collapsed to icons (cookie, so the page renders it right the first time). */
export const SIDEBAR_COOKIE = "tci-sidebar";

/**
 * Admin tools switch (Josh, 2026-11-16): off by default, so everyone sees the service layout.
 * On, it shows approvals, inbox, setup and the edit, upload and approve controls. It only
 * changes what is shown: the server still checks every permission on every action.
 */
export const ADMIN_COOKIE = "tci-admin";
