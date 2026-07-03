# Leg2 RFID Reporting Frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new self-contained SPA (`leg2-reporting/`) that renders an IPC-style "RFID events" report (pivot-by-S9 with dynamic checkpoint columns + master-detail) from the Supabase Leg2 project.

**Architecture:** Standalone Vite + React 19 + Tailwind v4 + shadcn/ui app in a new top-level folder, wired 100% to Leg2 via browser-direct PostgREST. Pure business logic (S9 derivations, dynamic checkpoint columns, pivot, time formatting) lives in `src/lib/*` and is unit-tested with Vitest; React components consume it. Auth is Supabase Auth of Leg2.

**Tech Stack:** React 19, Vite 7, TypeScript 5.6, Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui (Radix), wouter, `@supabase/supabase-js` v2, Vitest + @testing-library/react (jsdom).

## Global Constraints

- Data source project: **Leg2 `ubgatxfwpmyaqyfrwias`** ONLY. Never query EDGE Study `ewyhmmixqcubqokphebh`.
- View read: `public.vw_quicksight_rfid_report_movements`.
- `VITE_SUPABASE_URL=https://ubgatxfwpmyaqyfrwias.supabase.co`
- `VITE_SUPABASE_ANON_KEY=sb_publishable_diwQpIw5WRugkXdthHyipw_IGrDk95a` (publishable key; safe to embed).
- New app lives in `leg2-reporting/` at repo root; do NOT modify the existing `edge-rfid-dashboard` (`client/`, `server/`).
- Run all app commands with `pnpm --dir leg2-reporting <script>` (no `cd`).
- **Checkpoint columns are DYNAMIC**: derived from distinct `edi_equivalent` present in filtered data, ordered by numeric code, labeled via `CHECKPOINT_LABELS` with raw-code fallback. Never hardcode the column set.
- **Duration rule (hard):** any duration between two events is ALWAYS computed from `event_datetime_utc`. The UTC/Local toggle only changes which timestamp is *displayed*.
- Derivations: Orig Po Code = `s9_id.slice(0,6)`, Dest Po Code = `s9_id.slice(6,12)`, Site Code = `site_impc_code ?? centre_code`.
- Tab mapping: `OUTBOUND`/`TRANSIT_EXIT` → outbound; `INBOUND`/`TRANSIT_ENTRY` → inbound.
- **Terminology (user's, not IPC):** `reader_id`→"RFID Reader", `tag_id`→"RFID Tag", `s9_id`→"S9", `s9_id[0:6]`→"Origin IMPC", `s9_id[6:12]`→"Destination IMPC", `movement_id`→"Movement Id", timestamp→"Time", `site_impc_code ?? centre_code`→"Site".
- **i18n-ready (English now, translation later — no i18n framework yet):** every user-facing string comes from `src/i18n/strings.ts`; checkpoint column names come from `CHECKPOINT_LABELS`. Components NEVER hardcode visible text.
- Before the Leg2 `GRANT` (Task 12): name project+ref and ask explicit confirmation (CLAUDE.md anti-confusion rule).
- Spec: `docs/superpowers/specs/2026-07-03-leg2-rfid-reporting-frontend-design.md`.

---

### Task 1: Scaffold the `leg2-reporting/` app

**Files:**
- Create: `leg2-reporting/package.json`
- Create: `leg2-reporting/tsconfig.json`
- Create: `leg2-reporting/vite.config.ts`
- Create: `leg2-reporting/index.html`
- Create: `leg2-reporting/.gitignore`
- Create: `leg2-reporting/.env.local`
- Create: `leg2-reporting/src/index.css`
- Create: `leg2-reporting/src/main.tsx`
- Create: `leg2-reporting/src/App.tsx`
- Create: `leg2-reporting/src/vitest.setup.ts`
- Create: `leg2-reporting/src/lib/utils.ts`
- Create: `leg2-reporting/src/i18n/strings.ts`
- Test: `leg2-reporting/src/smoke.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a runnable app + Vitest harness. `@/*` alias → `leg2-reporting/src/*`. `cn(...)` helper in `@/lib/utils`. `strings` dictionary (English) in `@/i18n/strings` — the single source of all user-facing text.

- [ ] **Step 1: Create `leg2-reporting/package.json`**

```json
{
  "name": "leg2-reporting",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "tsc --noEmit"
  },
  "dependencies": {
    "@radix-ui/react-select": "^2.2.6",
    "@radix-ui/react-slot": "^1.2.3",
    "@radix-ui/react-switch": "^1.2.6",
    "@radix-ui/react-tabs": "^1.1.13",
    "@supabase/supabase-js": "^2.99.1",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.453.0",
    "react": "^19.2.1",
    "react-dom": "^19.2.1",
    "tailwind-merge": "^3.3.1",
    "wouter": "^3.3.5"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.14",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@types/node": "^24.7.0",
    "@types/react": "^19.2.1",
    "@types/react-dom": "^19.2.1",
    "@vitejs/plugin-react": "^5.0.4",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.1.14",
    "typescript": "5.6.3",
    "vite": "^7.1.7",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Create `leg2-reporting/tsconfig.json`**

```json
{
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"],
  "compilerOptions": {
    "target": "ESNext",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "lib": ["esnext", "dom", "dom.iterable"],
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "types": ["node", "vite/client", "vitest/globals", "@testing-library/jest-dom"],
    "paths": { "@/*": ["./src/*"] }
  }
}
```

- [ ] **Step 3: Create `leg2-reporting/vite.config.ts`**

```ts
/// <reference types="vitest" />
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 3100, host: true },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/vitest.setup.ts"],
  },
});
```

- [ ] **Step 4: Create `leg2-reporting/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Leg2 RFID Reporting</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `leg2-reporting/.gitignore`**

```
node_modules
dist
.env.local
*.log
```

- [ ] **Step 6: Create `leg2-reporting/.env.local`**

```
VITE_SUPABASE_URL=https://ubgatxfwpmyaqyfrwias.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_diwQpIw5WRugkXdthHyipw_IGrDk95a
```

- [ ] **Step 7: Create `leg2-reporting/src/index.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 8: Create `leg2-reporting/src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 9: Create `leg2-reporting/src/vitest.setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 9b: Create `leg2-reporting/src/i18n/strings.ts`** (single source of all UI text; English now, translatable later)

```ts
// All user-facing English strings live here so a future i18n layer can swap
// them per locale without hunting through components. Checkpoint column names
// live in CHECKPOINT_LABELS (src/lib/checkpoints.ts) as their own dictionary.
// Terminology is the USER's, not IPC's (RFID Reader, RFID Tag, ...).
export const strings = {
  appTitle: "Leg2 RFID Reporting — RFID events",
  auth: {
    heading: "Leg2 RFID Reporting",
    email: "Email",
    password: "Password",
    signIn: "Sign in",
    signingIn: "Signing in…",
    signOut: "Sign out",
  },
  tabs: { inbound: "Inbound", outbound: "Outbound" },
  timeMode: { utc: "UTC", local: "Local" },
  filters: {
    origCountry: "Orig country",
    destCountry: "Dest country",
    s9: "S9",
    rfidTag: "RFID Tag",
    all: "All",
    searchS9: "Search S9",
    searchRfidTag: "Search RFID Tag",
  },
  columns: {
    s9: "S9",
    origImpc: "Origin IMPC",
    destImpc: "Destination IMPC",
    rfidTag: "RFID Tag",
    rfidReader: "RFID Reader",
    movementId: "Movement Id",
    time: "Time",
    site: "Site",
    handover: "Handover",
  },
  states: {
    loading: "Loading…",
    noRows: "No movements match the current filters.",
    selectS9: "Select an S9 to see its events.",
    eventDetails: "Event details",
    errorPrefix: "Error: ",
  },
} as const;
```

- [ ] **Step 10: Create `leg2-reporting/src/App.tsx`**

```tsx
export default function App() {
  return <div>Leg2 RFID Reporting</div>;
}
```

- [ ] **Step 11: Create `leg2-reporting/src/main.tsx`**

```tsx
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 12: Write the smoke test `leg2-reporting/src/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("scaffold", () => {
  it("cn merges classes", () => {
    expect(cn("a", "b", false && "c")).toBe("a b");
  });
});
```

- [ ] **Step 13: Install deps and run the smoke test**

Run: `pnpm --dir leg2-reporting install`
Then: `pnpm --dir leg2-reporting test`
Expected: 1 passed. `smoke.test.ts` green.

- [ ] **Step 14: Verify the build works**

Run: `pnpm --dir leg2-reporting build`
Expected: `tsc` passes and Vite writes `leg2-reporting/dist/`. No errors.

- [ ] **Step 15: Commit**

```bash
git add leg2-reporting/package.json leg2-reporting/tsconfig.json leg2-reporting/vite.config.ts leg2-reporting/index.html leg2-reporting/.gitignore leg2-reporting/src
git commit -m "feat(leg2-reporting): scaffold standalone Vite+React app for Leg2"
```

---

### Task 2: S9 derivations and tab classification (`lib/s9.ts`)

**Files:**
- Create: `leg2-reporting/src/lib/s9.ts`
- Test: `leg2-reporting/src/lib/s9.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `deriveOrigPoCode(s9Id: string): string`
  - `deriveDestPoCode(s9Id: string): string`
  - `type Tab = 'inbound' | 'outbound'`
  - `classifyTab(movementType: string): Tab`

- [ ] **Step 1: Write the failing test `leg2-reporting/src/lib/s9.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { deriveOrigPoCode, deriveDestPoCode, classifyTab } from "@/lib/s9";

describe("s9 derivations", () => {
  const s9 = "INBOMBJPTYOAAEM60760004100101";

  it("origin Po code = first 6 chars", () => {
    expect(deriveOrigPoCode(s9)).toBe("INBOMB");
  });

  it("dest Po code = chars 7..12", () => {
    expect(deriveDestPoCode(s9)).toBe("JPTYOA");
  });

  it("classifies outbound movement types", () => {
    expect(classifyTab("OUTBOUND")).toBe("outbound");
    expect(classifyTab("TRANSIT_EXIT")).toBe("outbound");
  });

  it("classifies inbound movement types", () => {
    expect(classifyTab("INBOUND")).toBe("inbound");
    expect(classifyTab("TRANSIT_ENTRY")).toBe("inbound");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir leg2-reporting exec vitest run src/lib/s9.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/s9"`.

- [ ] **Step 3: Implement `leg2-reporting/src/lib/s9.ts`**

```ts
export type Tab = "inbound" | "outbound";

export function deriveOrigPoCode(s9Id: string): string {
  return s9Id.slice(0, 6);
}

export function deriveDestPoCode(s9Id: string): string {
  return s9Id.slice(6, 12);
}

export function classifyTab(movementType: string): Tab {
  return movementType === "OUTBOUND" || movementType === "TRANSIT_EXIT"
    ? "outbound"
    : "inbound";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir leg2-reporting exec vitest run src/lib/s9.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/s9.ts leg2-reporting/src/lib/s9.test.ts
git commit -m "feat(leg2-reporting): S9 Po-code derivations and tab classification"
```

---

### Task 3: Dynamic checkpoint columns (`lib/checkpoints.ts`)

**Files:**
- Create: `leg2-reporting/src/lib/checkpoints.ts`
- Test: `leg2-reporting/src/lib/checkpoints.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface CheckpointColumn { code: string; label: string }`
  - `const CHECKPOINT_LABELS: Record<string, string>`
  - `checkpointLabel(code: string): string`
  - `checkpointColumnsFromData(movs: { edi_equivalent: string | null }[]): CheckpointColumn[]`

- [ ] **Step 1: Write the failing test `leg2-reporting/src/lib/checkpoints.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { checkpointLabel, checkpointColumnsFromData } from "@/lib/checkpoints";

describe("checkpoint columns (dynamic)", () => {
  it("labels known codes, falls back to raw code", () => {
    expect(checkpointLabel("2320")).toBe("Exit Outbound AMU");
    expect(checkpointLabel("9999")).toBe("9999");
  });

  it("derives distinct columns ordered by numeric code", () => {
    const cols = checkpointColumnsFromData([
      { edi_equivalent: "2400" },
      { edi_equivalent: "2320" },
      { edi_equivalent: "2400" },
      { edi_equivalent: null },
    ]);
    expect(cols.map((c) => c.code)).toEqual(["2320", "2400"]);
  });

  it("a brand-new checkpoint appears automatically as a column", () => {
    const cols = checkpointColumnsFromData([
      { edi_equivalent: "2400" },
      { edi_equivalent: "2320" },
      { edi_equivalent: "2410" },
    ]);
    expect(cols.map((c) => c.code)).toEqual(["2320", "2400", "2410"]);
  });

  it("unknown code uses its raw code as label", () => {
    const cols = checkpointColumnsFromData([{ edi_equivalent: "9999" }]);
    expect(cols[0]).toEqual({ code: "9999", label: "9999" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir leg2-reporting exec vitest run src/lib/checkpoints.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/checkpoints"`.

- [ ] **Step 3: Implement `leg2-reporting/src/lib/checkpoints.ts`**

```ts
export interface CheckpointColumn {
  code: string;
  label: string;
}

/** IPC checkpoint code → human label. Extend as new codes get names. */
export const CHECKPOINT_LABELS: Record<string, string> = {
  "2300": "Exit From Outbound OE",
  "2310": "Entry Outbound AMU",
  "2320": "Exit Outbound AMU",
  "2400": "Entry Inbound AMU",
  "2410": "Exit Inbound AMU",
  "2420": "Entry Inbound OE",
  "2440": "Incorrect Inbound",
  "2450": "Backup",
};

export function checkpointLabel(code: string): string {
  return CHECKPOINT_LABELS[code] ?? code;
}

/**
 * Dynamic columns: the DISTINCT edi_equivalent values present in the data,
 * ordered ascending by numeric code. New checkpoints surface automatically.
 * Null edi_equivalent produces no column.
 */
export function checkpointColumnsFromData(
  movs: { edi_equivalent: string | null }[]
): CheckpointColumn[] {
  const codes = new Set<string>();
  for (const m of movs) {
    if (m.edi_equivalent) codes.add(m.edi_equivalent);
  }
  return [...codes]
    .sort((a, b) => Number(a) - Number(b))
    .map((code) => ({ code, label: checkpointLabel(code) }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir leg2-reporting exec vitest run src/lib/checkpoints.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/checkpoints.ts leg2-reporting/src/lib/checkpoints.test.ts
git commit -m "feat(leg2-reporting): dynamic checkpoint columns from edi_equivalent"
```

---

### Task 4: Time formatting and UTC-only duration (`lib/time.ts`)

**Files:**
- Create: `leg2-reporting/src/lib/time.ts`
- Test: `leg2-reporting/src/lib/time.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type TimeMode = 'utc' | 'local'`
  - `formatTimestamp(mov: { event_datetime_utc: string; event_datetime_local: string }, mode: TimeMode): string`
  - `durationHours(a: { event_datetime_utc: string }, b: { event_datetime_utc: string }): number`

- [ ] **Step 1: Write the failing test `leg2-reporting/src/lib/time.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { formatTimestamp, durationHours } from "@/lib/time";

describe("time", () => {
  const mov = {
    event_datetime_utc: "2026-07-03T10:00:00+00:00",
    event_datetime_local: "2026-07-03T19:00:00",
  };

  it("shows UTC or local based on mode", () => {
    expect(formatTimestamp(mov, "utc")).toBe("2026-07-03T10:00:00+00:00");
    expect(formatTimestamp(mov, "local")).toBe("2026-07-03T19:00:00");
  });

  it("duration ALWAYS uses UTC, ignoring local", () => {
    const a = {
      event_datetime_utc: "2026-07-03T10:00:00+00:00",
      event_datetime_local: "2026-07-03T19:00:00",
    };
    const b = {
      event_datetime_utc: "2026-07-03T12:00:00+00:00",
      event_datetime_local: "2026-07-03T13:00:00", // misleading local delta = 1h
    };
    expect(durationHours(a, b)).toBe(2); // 2h from UTC, not 1h from local
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir leg2-reporting exec vitest run src/lib/time.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/time"`.

- [ ] **Step 3: Implement `leg2-reporting/src/lib/time.ts`**

```ts
export type TimeMode = "utc" | "local";

export function formatTimestamp(
  mov: { event_datetime_utc: string; event_datetime_local: string },
  mode: TimeMode
): string {
  return mode === "utc" ? mov.event_datetime_utc : mov.event_datetime_local;
}

/**
 * Hours between two events. HARD RULE: always computed from event_datetime_utc,
 * never from local (DST/timezone changes would introduce artificial hours).
 */
export function durationHours(
  a: { event_datetime_utc: string },
  b: { event_datetime_utc: string }
): number {
  return (
    (Date.parse(b.event_datetime_utc) - Date.parse(a.event_datetime_utc)) /
    3_600_000
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir leg2-reporting exec vitest run src/lib/time.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/time.ts leg2-reporting/src/lib/time.test.ts
git commit -m "feat(leg2-reporting): time formatting + UTC-only duration rule"
```

---

### Task 5: Supabase client + movement fetch (`lib/supabase.ts`)

**Files:**
- Create: `leg2-reporting/src/lib/supabase.ts`
- Test: `leg2-reporting/src/lib/supabase.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface RfidMovement { ... }` (the row shape below)
  - `const supabase` (Supabase client for Leg2)
  - `buildMovementsUrl(baseUrl: string, opts: { dateFrom?: string; dateTo?: string; offset: number; limit: number }): string`
  - `fetchRfidMovements(filters: { dateFrom?: string; dateTo?: string }, deps?: { fetchFn?: typeof fetch; token?: string; anonKey?: string; baseUrl?: string }): Promise<RfidMovement[]>`

- [ ] **Step 1: Write the failing test `leg2-reporting/src/lib/supabase.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { buildMovementsUrl, fetchRfidMovements } from "@/lib/supabase";

const BASE = "https://x.supabase.co/rest/v1/vw_quicksight_rfid_report_movements";

describe("buildMovementsUrl", () => {
  it("orders by event_datetime_utc desc and paginates", () => {
    const url = buildMovementsUrl(BASE, { offset: 0, limit: 1000 });
    expect(url).toContain("order=event_datetime_utc.desc");
    expect(url).toContain("offset=0");
    expect(url).toContain("limit=1000");
    expect(url).toContain("select=");
  });

  it("adds date filters when present", () => {
    const url = buildMovementsUrl(BASE, {
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      offset: 0,
      limit: 1000,
    });
    expect(url).toContain("event_datetime_utc=gte.2026-01-01T00%3A00%3A00");
    expect(url).toContain("event_datetime_utc=lte.2026-01-31T23%3A59%3A59");
  });
});

describe("fetchRfidMovements", () => {
  it("concatenates pages until a short page ends pagination", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ movement_id: `a${i}` }));
    const page2 = [{ movement_id: "b0" }];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => page1 })
      .mockResolvedValueOnce({ ok: true, json: async () => page2 });

    const rows = await fetchRfidMovements(
      {},
      { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "k", baseUrl: BASE }
    );

    expect(rows).toHaveLength(1001);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("throws on non-ok response", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, text: async () => "no grant" });
    await expect(
      fetchRfidMovements(
        {},
        { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "k", baseUrl: BASE }
      )
    ).rejects.toThrow(/403/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir leg2-reporting exec vitest run src/lib/supabase.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/supabase"`.

- [ ] **Step 3: Implement `leg2-reporting/src/lib/supabase.ts`**

```ts
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export interface RfidMovement {
  movement_id: string;
  s9_id: string;
  tag_id: string | null;
  reader_id: string;
  movement_type: "INBOUND" | "OUTBOUND" | "TRANSIT_ENTRY" | "TRANSIT_EXIT";
  route_country_role: "ORIGIN" | "DESTINATION" | "TRANSIT" | null;
  edi_equivalent: string | null;
  origin_country_code: string | null;
  destination_country_code: string | null;
  movement_country_code: string | null;
  country_sequence_number: number | null;
  event_datetime_utc: string;
  event_datetime_local: string;
  reader_timezone: string;
  site_impc_code: string | null;
  centre_code: string;
  site_name: string | null;
  city: string | null;
  handover_point: boolean;
  handover_quality_status: string | null;
}

const SELECT_COLS = [
  "movement_id", "s9_id", "tag_id", "reader_id", "movement_type",
  "route_country_role", "edi_equivalent", "origin_country_code",
  "destination_country_code", "movement_country_code", "country_sequence_number",
  "event_datetime_utc", "event_datetime_local", "reader_timezone",
  "site_impc_code", "centre_code", "site_name", "city",
  "handover_point", "handover_quality_status",
].join(",");

const VIEW = "vw_quicksight_rfid_report_movements";
const PAGE_SIZE = 1000;

export function buildMovementsUrl(
  baseUrl: string,
  opts: { dateFrom?: string; dateTo?: string; offset: number; limit: number }
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("select", SELECT_COLS);
  url.searchParams.set("order", "event_datetime_utc.desc");
  url.searchParams.set("offset", String(opts.offset));
  url.searchParams.set("limit", String(opts.limit));
  if (opts.dateFrom)
    url.searchParams.append("event_datetime_utc", `gte.${opts.dateFrom}T00:00:00`);
  if (opts.dateTo)
    url.searchParams.append("event_datetime_utc", `lte.${opts.dateTo}T23:59:59`);
  return url.toString();
}

export async function fetchRfidMovements(
  filters: { dateFrom?: string; dateTo?: string },
  deps: {
    fetchFn?: typeof fetch;
    token?: string;
    anonKey?: string;
    baseUrl?: string;
  } = {}
): Promise<RfidMovement[]> {
  const fetchFn = deps.fetchFn ?? fetch;
  const anonKey = deps.anonKey ?? SUPABASE_ANON_KEY;
  const token = deps.token ?? anonKey;
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${VIEW}`;
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const all: RfidMovement[] = [];
  let offset = 0;
  while (true) {
    const url = buildMovementsUrl(baseUrl, {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      offset,
      limit: PAGE_SIZE,
    });
    const res = await fetchFn(url, { headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Leg2 movements fetch failed: ${res.status} ${body}`);
    }
    const page = (await res.json()) as RfidMovement[];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir leg2-reporting exec vitest run src/lib/supabase.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/supabase.ts leg2-reporting/src/lib/supabase.test.ts
git commit -m "feat(leg2-reporting): Leg2 supabase client + paginated movements fetch"
```

---

### Task 6: Pivot builder (`lib/pivot.ts`)

**Files:**
- Create: `leg2-reporting/src/lib/pivot.ts`
- Test: `leg2-reporting/src/lib/pivot.test.ts`

**Interfaces:**
- Consumes: `RfidMovement` (Task 5), `CheckpointColumn`/`checkpointColumnsFromData` (Task 3), `deriveOrigPoCode`/`deriveDestPoCode` (Task 2).
- Produces:
  - `interface S9PivotRow { s9_id; origPoCode; destPoCode; rte: string|null; cells: Record<string, RfidMovement>; transits: RfidMovement[]; all: RfidMovement[] }`
  - `interface RfidEventsReport { columns: CheckpointColumn[]; rows: S9PivotRow[] }`
  - `pivotByS9(movs: RfidMovement[]): RfidEventsReport`

- [ ] **Step 1: Write the failing test `leg2-reporting/src/lib/pivot.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { pivotByS9 } from "@/lib/pivot";
import type { RfidMovement } from "@/lib/supabase";

function mov(p: Partial<RfidMovement>): RfidMovement {
  return {
    movement_id: "m", s9_id: "INBOMBJPTYOAAEM60760004100101", tag_id: "G.1UPU.X",
    reader_id: "R1", movement_type: "OUTBOUND", route_country_role: "ORIGIN",
    edi_equivalent: "2320", origin_country_code: "IN", destination_country_code: "JP",
    movement_country_code: "IN", country_sequence_number: 1,
    event_datetime_utc: "2026-07-03T10:00:00+00:00",
    event_datetime_local: "2026-07-03T19:00:00", reader_timezone: "Asia/Kolkata",
    site_impc_code: "INMUBA", centre_code: "INMUBA", site_name: "Mumbai",
    city: "Mumbai", handover_point: true, handover_quality_status: "handover_ok",
    ...p,
  };
}

describe("pivotByS9", () => {
  it("builds dynamic columns and one row per S9 with cells keyed by checkpoint", () => {
    const report = pivotByS9([
      mov({ s9_id: "S1", edi_equivalent: "2320", event_datetime_utc: "2026-07-03T10:00:00+00:00" }),
      mov({ s9_id: "S1", edi_equivalent: "2400", event_datetime_utc: "2026-07-05T10:00:00+00:00" }),
    ]);
    expect(report.columns.map((c) => c.code)).toEqual(["2320", "2400"]);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].cells["2320"].event_datetime_utc).toBe("2026-07-03T10:00:00+00:00");
    expect(report.rows[0].cells["2400"].event_datetime_utc).toBe("2026-07-05T10:00:00+00:00");
  });

  it("keeps the earliest movement when a S9 hits the same checkpoint twice", () => {
    const report = pivotByS9([
      mov({ s9_id: "S1", edi_equivalent: "2320", event_datetime_utc: "2026-07-03T12:00:00+00:00" }),
      mov({ s9_id: "S1", edi_equivalent: "2320", event_datetime_utc: "2026-07-03T08:00:00+00:00" }),
    ]);
    expect(report.rows[0].cells["2320"].event_datetime_utc).toBe("2026-07-03T08:00:00+00:00");
  });

  it("derives Po codes and Rte, and collects transits", () => {
    const report = pivotByS9([
      mov({ s9_id: "INBOMBJPTYOAAEM60760004100101", edi_equivalent: "2400", movement_type: "TRANSIT_ENTRY" }),
    ]);
    const row = report.rows[0];
    expect(row.origPoCode).toBe("INBOMB");
    expect(row.destPoCode).toBe("JPTYOA");
    expect(row.rte).toBe("G.1UPU.X");
    expect(row.transits).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir leg2-reporting exec vitest run src/lib/pivot.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/pivot"`.

- [ ] **Step 3: Implement `leg2-reporting/src/lib/pivot.ts`**

```ts
import type { RfidMovement } from "@/lib/supabase";
import {
  checkpointColumnsFromData,
  type CheckpointColumn,
} from "@/lib/checkpoints";
import { deriveOrigPoCode, deriveDestPoCode } from "@/lib/s9";

export interface S9PivotRow {
  s9_id: string;
  origPoCode: string;
  destPoCode: string;
  rte: string | null;
  cells: Record<string, RfidMovement>;
  transits: RfidMovement[];
  all: RfidMovement[];
}

export interface RfidEventsReport {
  columns: CheckpointColumn[];
  rows: S9PivotRow[];
}

function latestUtc(movs: RfidMovement[]): string {
  return movs.reduce(
    (max, m) => (m.event_datetime_utc > max ? m.event_datetime_utc : max),
    ""
  );
}

export function pivotByS9(movs: RfidMovement[]): RfidEventsReport {
  const columns = checkpointColumnsFromData(movs);

  const byS9 = new Map<string, RfidMovement[]>();
  for (const m of movs) {
    const group = byS9.get(m.s9_id);
    if (group) group.push(m);
    else byS9.set(m.s9_id, [m]);
  }

  const rows: S9PivotRow[] = [];
  for (const [s9_id, group] of byS9) {
    const cells: Record<string, RfidMovement> = {};
    for (const m of group) {
      if (!m.edi_equivalent) continue;
      const existing = cells[m.edi_equivalent];
      if (!existing || m.event_datetime_utc < existing.event_datetime_utc) {
        cells[m.edi_equivalent] = m;
      }
    }
    const transits = group.filter(
      (m) => m.movement_type === "TRANSIT_ENTRY" || m.movement_type === "TRANSIT_EXIT"
    );
    const rte = group.find((m) => m.tag_id)?.tag_id ?? null;
    rows.push({
      s9_id,
      origPoCode: deriveOrigPoCode(s9_id),
      destPoCode: deriveDestPoCode(s9_id),
      rte,
      cells,
      transits,
      all: group,
    });
  }

  // Most recent activity first (ISO UTC strings compare lexicographically).
  rows.sort((a, b) => latestUtc(b.all).localeCompare(latestUtc(a.all)));
  return { columns, rows };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir leg2-reporting exec vitest run src/lib/pivot.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/pivot.ts leg2-reporting/src/lib/pivot.test.ts
git commit -m "feat(leg2-reporting): pivot movements by S9 with dynamic columns"
```

---

### Task 7: Report filtering (`lib/filter.ts`)

**Files:**
- Create: `leg2-reporting/src/lib/filter.ts`
- Test: `leg2-reporting/src/lib/filter.test.ts`

**Interfaces:**
- Consumes: `RfidMovement` (Task 5), `classifyTab`/`Tab` (Task 2).
- Produces:
  - `interface ReportFilterState { tab: Tab; originCountry: string | null; destCountry: string | null; s9Query: string; rteQuery: string }`
  - `filterMovements(movs: RfidMovement[], f: ReportFilterState): RfidMovement[]`
  - `distinctCountries(movs: RfidMovement[], field: 'origin_country_code' | 'destination_country_code'): string[]`

- [ ] **Step 1: Write the failing test `leg2-reporting/src/lib/filter.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { filterMovements, distinctCountries, type ReportFilterState } from "@/lib/filter";
import type { RfidMovement } from "@/lib/supabase";

function mov(p: Partial<RfidMovement>): RfidMovement {
  return {
    movement_id: "m", s9_id: "S1", tag_id: "G.1UPU.X", reader_id: "R1",
    movement_type: "OUTBOUND", route_country_role: "ORIGIN", edi_equivalent: "2320",
    origin_country_code: "IN", destination_country_code: "JP",
    movement_country_code: "IN", country_sequence_number: 1,
    event_datetime_utc: "2026-07-03T10:00:00+00:00",
    event_datetime_local: "2026-07-03T19:00:00", reader_timezone: "Asia/Kolkata",
    site_impc_code: "INMUBA", centre_code: "INMUBA", site_name: "Mumbai",
    city: "Mumbai", handover_point: true, handover_quality_status: "handover_ok",
    ...p,
  };
}

const base: ReportFilterState = {
  tab: "outbound", originCountry: null, destCountry: null, s9Query: "", rteQuery: "",
};

describe("filterMovements", () => {
  it("outbound tab keeps OUTBOUND and TRANSIT_EXIT", () => {
    const movs = [
      mov({ movement_type: "OUTBOUND" }),
      mov({ movement_type: "TRANSIT_EXIT" }),
      mov({ movement_type: "INBOUND" }),
    ];
    expect(filterMovements(movs, base)).toHaveLength(2);
  });

  it("filters by origin/dest country and S9/Rte substring", () => {
    const movs = [
      mov({ s9_id: "AAA111", tag_id: "G.1UPU.KEEP", origin_country_code: "IN" }),
      mov({ s9_id: "BBB222", tag_id: "G.1UPU.SKIP", origin_country_code: "BR" }),
    ];
    expect(filterMovements(movs, { ...base, originCountry: "IN" })).toHaveLength(1);
    expect(filterMovements(movs, { ...base, s9Query: "aaa" })).toHaveLength(1);
    expect(filterMovements(movs, { ...base, rteQuery: "keep" })).toHaveLength(1);
  });
});

describe("distinctCountries", () => {
  it("returns sorted distinct non-null codes", () => {
    const movs = [
      mov({ origin_country_code: "JP" }),
      mov({ origin_country_code: "IN" }),
      mov({ origin_country_code: "IN" }),
      mov({ origin_country_code: null }),
    ];
    expect(distinctCountries(movs, "origin_country_code")).toEqual(["IN", "JP"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir leg2-reporting exec vitest run src/lib/filter.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/filter"`.

- [ ] **Step 3: Implement `leg2-reporting/src/lib/filter.ts`**

```ts
import type { RfidMovement } from "@/lib/supabase";
import { classifyTab, type Tab } from "@/lib/s9";

export interface ReportFilterState {
  tab: Tab;
  originCountry: string | null;
  destCountry: string | null;
  s9Query: string;
  rteQuery: string;
}

export function filterMovements(
  movs: RfidMovement[],
  f: ReportFilterState
): RfidMovement[] {
  const s9q = f.s9Query.trim().toLowerCase();
  const rteq = f.rteQuery.trim().toLowerCase();
  return movs.filter((m) => {
    if (classifyTab(m.movement_type) !== f.tab) return false;
    if (f.originCountry && m.origin_country_code !== f.originCountry) return false;
    if (f.destCountry && m.destination_country_code !== f.destCountry) return false;
    if (s9q && !m.s9_id.toLowerCase().includes(s9q)) return false;
    if (rteq && !(m.tag_id ?? "").toLowerCase().includes(rteq)) return false;
    return true;
  });
}

export function distinctCountries(
  movs: RfidMovement[],
  field: "origin_country_code" | "destination_country_code"
): string[] {
  const set = new Set<string>();
  for (const m of movs) {
    const v = m[field];
    if (v) set.add(v);
  }
  return [...set].sort();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir leg2-reporting exec vitest run src/lib/filter.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/filter.ts leg2-reporting/src/lib/filter.test.ts
git commit -m "feat(leg2-reporting): movement filtering + distinct country options"
```

---

### Task 8: Copy shadcn/ui primitives + Auth context

**Files:**
- Create: `leg2-reporting/src/components/ui/button.tsx` (copied)
- Create: `leg2-reporting/src/components/ui/input.tsx` (copied)
- Create: `leg2-reporting/src/components/ui/select.tsx` (copied)
- Create: `leg2-reporting/src/components/ui/tabs.tsx` (copied)
- Create: `leg2-reporting/src/components/ui/table.tsx` (copied)
- Create: `leg2-reporting/src/components/ui/switch.tsx` (copied)
- Create: `leg2-reporting/src/components/ui/label.tsx` (copied)
- Create: `leg2-reporting/src/contexts/AuthContext.tsx`
- Test: `leg2-reporting/src/contexts/AuthContext.test.tsx`

**Interfaces:**
- Consumes: `supabase` (Task 5), `cn` (Task 1).
- Produces: `AuthProvider`, `useAuth()` returning `{ session, user, isLoading, signIn, signOut }`; shadcn primitives importing from `@/lib/utils`.

- [ ] **Step 1: Copy the 7 shadcn primitives from the legacy app**

Run:
```bash
mkdir -p leg2-reporting/src/components/ui
cp client/src/components/ui/button.tsx leg2-reporting/src/components/ui/button.tsx
cp client/src/components/ui/input.tsx leg2-reporting/src/components/ui/input.tsx
cp client/src/components/ui/select.tsx leg2-reporting/src/components/ui/select.tsx
cp client/src/components/ui/tabs.tsx leg2-reporting/src/components/ui/tabs.tsx
cp client/src/components/ui/table.tsx leg2-reporting/src/components/ui/table.tsx
cp client/src/components/ui/switch.tsx leg2-reporting/src/components/ui/switch.tsx
cp client/src/components/ui/label.tsx leg2-reporting/src/components/ui/label.tsx
```

These already import `@/lib/utils` (present) and their Radix deps are in `package.json` (Task 1). No edits needed unless `tsc` reports a missing import in Step 4.

- [ ] **Step 2: Write the failing test `leg2-reporting/src/contexts/AuthContext.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const getSession = vi.fn();
const onAuthStateChange = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession, onAuthStateChange } },
}));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";

function Probe() {
  const { isLoading, session } = useAuth();
  return <div>{isLoading ? "loading" : session ? "in" : "out"}</div>;
}

describe("AuthContext", () => {
  beforeEach(() => {
    getSession.mockReset();
    onAuthStateChange.mockReset();
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  });

  it("resolves to signed-out when no session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByText("out")).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --dir leg2-reporting exec vitest run src/contexts/AuthContext.test.tsx`
Expected: FAIL — `Failed to resolve import "@/contexts/AuthContext"`.

- [ ] **Step 4: Implement `leg2-reporting/src/contexts/AuthContext.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setIsLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? error.message : null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const user = session?.user ?? null;

  return (
    <AuthContext.Provider value={{ session, user, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --dir leg2-reporting exec vitest run src/contexts/AuthContext.test.tsx`
Expected: 1 passed.

- [ ] **Step 6: Typecheck the copied primitives**

Run: `pnpm --dir leg2-reporting check`
Expected: no errors. (If a copied `ui/*` file imports a primitive not in the list, either copy that file too or remove the unused import — keep it minimal.)

- [ ] **Step 7: Commit**

```bash
git add leg2-reporting/src/components/ui leg2-reporting/src/contexts/AuthContext.tsx leg2-reporting/src/contexts/AuthContext.test.tsx
git commit -m "feat(leg2-reporting): shadcn ui primitives + Leg2 Auth context"
```

---

### Task 9: Report data hook (`hooks/useRfidEventsReport.ts`)

**Files:**
- Create: `leg2-reporting/src/hooks/useRfidEventsReport.ts`
- Test: `leg2-reporting/src/hooks/useRfidEventsReport.test.tsx`

**Interfaces:**
- Consumes: `fetchRfidMovements` (Task 5), `filterMovements`/`distinctCountries`/`ReportFilterState` (Task 7), `pivotByS9`/`RfidEventsReport` (Task 6), `supabase` (Task 5).
- Produces: `useRfidEventsReport()` returning `{ loading, error, report, filter, setFilter, originOptions, destOptions, reload }` where `report: RfidEventsReport`, `filter: ReportFilterState`.

- [ ] **Step 1: Write the failing test `leg2-reporting/src/hooks/useRfidEventsReport.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { RfidMovement } from "@/lib/supabase";

const fetchMovements = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  fetchRfidMovements: (...args: unknown[]) => fetchMovements(...args),
}));

import { useRfidEventsReport } from "@/hooks/useRfidEventsReport";

function mov(p: Partial<RfidMovement>): RfidMovement {
  return {
    movement_id: "m", s9_id: "S1", tag_id: "G.1UPU.X", reader_id: "R1",
    movement_type: "OUTBOUND", route_country_role: "ORIGIN", edi_equivalent: "2320",
    origin_country_code: "IN", destination_country_code: "JP",
    movement_country_code: "IN", country_sequence_number: 1,
    event_datetime_utc: "2026-07-03T10:00:00+00:00",
    event_datetime_local: "2026-07-03T19:00:00", reader_timezone: "Asia/Kolkata",
    site_impc_code: "INMUBA", centre_code: "INMUBA", site_name: "Mumbai",
    city: "Mumbai", handover_point: true, handover_quality_status: "handover_ok",
    ...p,
  };
}

describe("useRfidEventsReport", () => {
  beforeEach(() => fetchMovements.mockReset());

  it("loads, defaults to outbound tab, and pivots filtered data", async () => {
    fetchMovements.mockResolvedValue([
      mov({ s9_id: "S1", movement_type: "OUTBOUND", edi_equivalent: "2320" }),
      mov({ s9_id: "S2", movement_type: "INBOUND", edi_equivalent: "2400" }),
    ]);
    const { result } = renderHook(() => useRfidEventsReport());
    await waitFor(() => expect(result.current.loading).toBe(false));
    // default tab outbound → only S1
    expect(result.current.report.rows.map((r) => r.s9_id)).toEqual(["S1"]);
    expect(result.current.report.columns.map((c) => c.code)).toEqual(["2320"]);
  });

  it("switching tab to inbound re-pivots", async () => {
    fetchMovements.mockResolvedValue([
      mov({ s9_id: "S1", movement_type: "OUTBOUND", edi_equivalent: "2320" }),
      mov({ s9_id: "S2", movement_type: "INBOUND", edi_equivalent: "2400" }),
    ]);
    const { result } = renderHook(() => useRfidEventsReport());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setFilter((f) => ({ ...f, tab: "inbound" })));
    expect(result.current.report.rows.map((r) => r.s9_id)).toEqual(["S2"]);
    expect(result.current.report.columns.map((c) => c.code)).toEqual(["2400"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir leg2-reporting exec vitest run src/hooks/useRfidEventsReport.test.tsx`
Expected: FAIL — `Failed to resolve import "@/hooks/useRfidEventsReport"`.

- [ ] **Step 3: Implement `leg2-reporting/src/hooks/useRfidEventsReport.ts`**

```ts
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchRfidMovements, supabase, type RfidMovement } from "@/lib/supabase";
import {
  filterMovements,
  distinctCountries,
  type ReportFilterState,
} from "@/lib/filter";
import { pivotByS9, type RfidEventsReport } from "@/lib/pivot";

const INITIAL_FILTER: ReportFilterState = {
  tab: "outbound",
  originCountry: null,
  destCountry: null,
  s9Query: "",
  rteQuery: "",
};

export function useRfidEventsReport() {
  const [movements, setMovements] = useState<RfidMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReportFilterState>(INITIAL_FILTER);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const rows = await fetchRfidMovements({}, token ? { token } : {});
      setMovements(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () => filterMovements(movements, filter),
    [movements, filter]
  );
  const report: RfidEventsReport = useMemo(
    () => pivotByS9(filtered),
    [filtered]
  );

  // Country options come from the current tab slice (ignoring country filters).
  const tabScoped = useMemo(
    () =>
      filterMovements(movements, {
        ...filter,
        originCountry: null,
        destCountry: null,
        s9Query: "",
        rteQuery: "",
      }),
    [movements, filter]
  );
  const originOptions = useMemo(
    () => distinctCountries(tabScoped, "origin_country_code"),
    [tabScoped]
  );
  const destOptions = useMemo(
    () => distinctCountries(tabScoped, "destination_country_code"),
    [tabScoped]
  );

  return {
    loading,
    error,
    report,
    filter,
    setFilter,
    originOptions,
    destOptions,
    reload: load,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir leg2-reporting exec vitest run src/hooks/useRfidEventsReport.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/hooks/useRfidEventsReport.ts leg2-reporting/src/hooks/useRfidEventsReport.test.tsx
git commit -m "feat(leg2-reporting): useRfidEventsReport hook (fetch+filter+pivot)"
```

---

### Task 10: Pivot table + detail table components

**Files:**
- Create: `leg2-reporting/src/components/RfidEventsPivot.tsx`
- Create: `leg2-reporting/src/components/EventDetailsTable.tsx`
- Test: `leg2-reporting/src/components/RfidEventsPivot.test.tsx`

**Interfaces:**
- Consumes: `RfidEventsReport`/`S9PivotRow` (Task 6), `RfidMovement` (Task 5), `formatTimestamp`/`TimeMode` (Task 4), `checkpointLabel` (Task 3), `ui/table` (Task 8), `cn` (Task 1).
- Produces:
  - `RfidEventsPivot({ report, timeMode, selectedS9, onSelectS9 }: { report: RfidEventsReport; timeMode: TimeMode; selectedS9: string | null; onSelectS9: (s9: string) => void })`
  - `EventDetailsTable({ movements, timeMode }: { movements: RfidMovement[]; timeMode: TimeMode })`

- [ ] **Step 1: Write the failing test `leg2-reporting/src/components/RfidEventsPivot.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RfidEventsPivot } from "@/components/RfidEventsPivot";
import type { RfidEventsReport } from "@/lib/pivot";

const report: RfidEventsReport = {
  columns: [
    { code: "2320", label: "Exit Outbound AMU" },
    { code: "2410", label: "Exit Inbound AMU" },
  ],
  rows: [
    {
      s9_id: "INBOMBJPTYOAAEM60760004100101",
      origPoCode: "INBOMB",
      destPoCode: "JPTYOA",
      rte: "G.1UPU.X",
      cells: {
        "2320": {
          event_datetime_utc: "2026-07-03T10:00:00+00:00",
          event_datetime_local: "2026-07-03T19:00:00",
        } as any,
      },
      transits: [],
      all: [],
    },
  ],
};

describe("RfidEventsPivot", () => {
  it("renders a dynamic column per checkpoint present (incl. new ones)", () => {
    render(
      <RfidEventsPivot report={report} timeMode="utc" selectedS9={null} onSelectS9={() => {}} />
    );
    expect(screen.getByText("Exit Outbound AMU")).toBeInTheDocument();
    expect(screen.getByText("Exit Inbound AMU")).toBeInTheDocument(); // dynamic col
    expect(screen.getByText("2026-07-03T10:00:00+00:00")).toBeInTheDocument();
  });

  it("fires onSelectS9 when a row is clicked", () => {
    const onSelect = vi.fn();
    render(
      <RfidEventsPivot report={report} timeMode="utc" selectedS9={null} onSelectS9={onSelect} />
    );
    fireEvent.click(screen.getByText("INBOMBJPTYOAAEM60760004100101"));
    expect(onSelect).toHaveBeenCalledWith("INBOMBJPTYOAAEM60760004100101");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir leg2-reporting exec vitest run src/components/RfidEventsPivot.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/RfidEventsPivot"`.

- [ ] **Step 3: Implement `leg2-reporting/src/components/EventDetailsTable.tsx`**

```tsx
import type { RfidMovement } from "@/lib/supabase";
import { formatTimestamp, type TimeMode } from "@/lib/time";
import { strings } from "@/i18n/strings";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export function EventDetailsTable({
  movements,
  timeMode,
}: {
  movements: RfidMovement[];
  timeMode: TimeMode;
}) {
  if (movements.length === 0) {
    return <p className="text-sm text-muted-foreground p-4">{strings.states.selectS9}</p>;
  }
  const sorted = [...movements].sort((a, b) =>
    a.event_datetime_utc.localeCompare(b.event_datetime_utc)
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{strings.columns.s9}</TableHead>
          <TableHead>{strings.columns.rfidTag}</TableHead>
          <TableHead>{strings.columns.movementId}</TableHead>
          <TableHead>{strings.columns.time}</TableHead>
          <TableHead>{strings.columns.site}</TableHead>
          <TableHead>{strings.columns.rfidReader}</TableHead>
          <TableHead>{strings.columns.handover}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((m) => (
          <TableRow key={m.movement_id}>
            <TableCell className="font-mono text-xs">{m.s9_id}</TableCell>
            <TableCell className="font-mono text-xs">{m.tag_id ?? "—"}</TableCell>
            <TableCell className="font-mono text-xs">{m.movement_id}</TableCell>
            <TableCell className="font-mono text-xs">{formatTimestamp(m, timeMode)}</TableCell>
            <TableCell>{m.site_impc_code ?? m.centre_code}</TableCell>
            <TableCell className="font-mono text-xs">{m.reader_id}</TableCell>
            <TableCell>{m.handover_quality_status ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 4: Implement `leg2-reporting/src/components/RfidEventsPivot.tsx`**

```tsx
import type { RfidEventsReport } from "@/lib/pivot";
import { formatTimestamp, type TimeMode } from "@/lib/time";
import { strings } from "@/i18n/strings";
import { cn } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export function RfidEventsPivot({
  report,
  timeMode,
  selectedS9,
  onSelectS9,
}: {
  report: RfidEventsReport;
  timeMode: TimeMode;
  selectedS9: string | null;
  onSelectS9: (s9: string) => void;
}) {
  if (report.rows.length === 0) {
    return <p className="text-sm text-muted-foreground p-4">{strings.states.noRows}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{strings.columns.s9}</TableHead>
          <TableHead>{strings.columns.origImpc}</TableHead>
          <TableHead>{strings.columns.destImpc}</TableHead>
          <TableHead>{strings.columns.rfidTag}</TableHead>
          {report.columns.map((c) => (
            <TableHead key={c.code}>{c.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.rows.map((row) => (
          <TableRow
            key={row.s9_id}
            onClick={() => onSelectS9(row.s9_id)}
            className={cn(
              "cursor-pointer",
              selectedS9 === row.s9_id && "bg-muted"
            )}
          >
            <TableCell className="font-mono text-xs">{row.s9_id}</TableCell>
            <TableCell>{row.origPoCode}</TableCell>
            <TableCell>{row.destPoCode}</TableCell>
            <TableCell className="font-mono text-xs">{row.rte ?? "—"}</TableCell>
            {report.columns.map((c) => {
              const m = row.cells[c.code];
              return (
                <TableCell key={c.code} className="font-mono text-xs">
                  {m ? formatTimestamp(m, timeMode) : ""}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --dir leg2-reporting exec vitest run src/components/RfidEventsPivot.test.tsx`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add leg2-reporting/src/components/RfidEventsPivot.tsx leg2-reporting/src/components/EventDetailsTable.tsx leg2-reporting/src/components/RfidEventsPivot.test.tsx
git commit -m "feat(leg2-reporting): pivot + event-details tables with dynamic columns"
```

---

### Task 11: Filters bar, page, login, and routing

**Files:**
- Create: `leg2-reporting/src/components/ReportFilters.tsx`
- Create: `leg2-reporting/src/pages/RfidEventsPage.tsx`
- Create: `leg2-reporting/src/pages/LoginPage.tsx`
- Modify: `leg2-reporting/src/App.tsx`
- Test: `leg2-reporting/src/components/ReportFilters.test.tsx`

**Interfaces:**
- Consumes: `ReportFilterState` (Task 7), `TimeMode` (Task 4), `useRfidEventsReport` (Task 9), `RfidEventsPivot`/`EventDetailsTable` (Task 10), `AuthProvider`/`useAuth` (Task 8), `ui/*` (Task 8).
- Produces: `ReportFilters` (controlled), `RfidEventsPage`, `LoginPage`, and an `App` that gates the page behind auth.

- [ ] **Step 1: Write the failing test `leg2-reporting/src/components/ReportFilters.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReportFilters } from "@/components/ReportFilters";
import type { ReportFilterState } from "@/lib/filter";

const base: ReportFilterState = {
  tab: "outbound", originCountry: null, destCountry: null, s9Query: "", rteQuery: "",
};

describe("ReportFilters", () => {
  it("renders the S9 search and reports typing", () => {
    const setFilter = vi.fn();
    render(
      <ReportFilters
        filter={base}
        setFilter={setFilter}
        originOptions={["IN", "JP"]}
        destOptions={["JP"]}
        timeMode="utc"
        onTimeModeChange={() => {}}
      />
    );
    fireEvent.change(screen.getByPlaceholderText("Search S9"), { target: { value: "abc" } });
    expect(setFilter).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir leg2-reporting exec vitest run src/components/ReportFilters.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/ReportFilters"`.

- [ ] **Step 3: Implement `leg2-reporting/src/components/ReportFilters.tsx`**

```tsx
import type { Dispatch, SetStateAction } from "react";
import type { ReportFilterState } from "@/lib/filter";
import type { TimeMode } from "@/lib/time";
import { strings } from "@/i18n/strings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const ALL = "__all__";

export function ReportFilters({
  filter,
  setFilter,
  originOptions,
  destOptions,
  timeMode,
  onTimeModeChange,
}: {
  filter: ReportFilterState;
  setFilter: Dispatch<SetStateAction<ReportFilterState>>;
  originOptions: string[];
  destOptions: string[];
  timeMode: TimeMode;
  onTimeModeChange: (m: TimeMode) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Tabs
          value={filter.tab}
          onValueChange={(v) =>
            setFilter((f) => ({ ...f, tab: v as ReportFilterState["tab"] }))
          }
        >
          <TabsList>
            <TabsTrigger value="inbound">{strings.tabs.inbound}</TabsTrigger>
            <TabsTrigger value="outbound">{strings.tabs.outbound}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Label htmlFor="tz">{strings.timeMode.utc}</Label>
          <Switch
            id="tz"
            checked={timeMode === "local"}
            onCheckedChange={(c) => onTimeModeChange(c ? "local" : "utc")}
          />
          <Label htmlFor="tz">{strings.timeMode.local}</Label>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label>{strings.filters.origCountry}</Label>
          <Select
            value={filter.originCountry ?? ALL}
            onValueChange={(v) =>
              setFilter((f) => ({ ...f, originCountry: v === ALL ? null : v }))
            }
          >
            <SelectTrigger className="w-40"><SelectValue placeholder={strings.filters.all} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{strings.filters.all}</SelectItem>
              {originOptions.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>{strings.filters.destCountry}</Label>
          <Select
            value={filter.destCountry ?? ALL}
            onValueChange={(v) =>
              setFilter((f) => ({ ...f, destCountry: v === ALL ? null : v }))
            }
          >
            <SelectTrigger className="w-40"><SelectValue placeholder={strings.filters.all} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{strings.filters.all}</SelectItem>
              {destOptions.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>{strings.filters.s9}</Label>
          <Input
            placeholder={strings.filters.searchS9}
            value={filter.s9Query}
            onChange={(e) => setFilter((f) => ({ ...f, s9Query: e.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>{strings.filters.rfidTag}</Label>
          <Input
            placeholder={strings.filters.searchRfidTag}
            value={filter.rteQuery}
            onChange={(e) => setFilter((f) => ({ ...f, rteQuery: e.target.value }))}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the filters test to verify it passes**

Run: `pnpm --dir leg2-reporting exec vitest run src/components/ReportFilters.test.tsx`
Expected: 1 passed.

- [ ] **Step 5: Implement `leg2-reporting/src/pages/LoginPage.tsx`**

```tsx
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { strings } from "@/i18n/strings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn(email, password);
    setError(error);
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={onSubmit} className="flex flex-col gap-3 w-72">
        <h1 className="text-lg font-semibold">{strings.auth.heading}</h1>
        <Label>{strings.auth.email}</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Label>{strings.auth.password}</Label>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={busy}>{busy ? strings.auth.signingIn : strings.auth.signIn}</Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: Implement `leg2-reporting/src/pages/RfidEventsPage.tsx`**

```tsx
import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRfidEventsReport } from "@/hooks/useRfidEventsReport";
import { ReportFilters } from "@/components/ReportFilters";
import { RfidEventsPivot } from "@/components/RfidEventsPivot";
import { EventDetailsTable } from "@/components/EventDetailsTable";
import { strings } from "@/i18n/strings";
import { Button } from "@/components/ui/button";
import type { TimeMode } from "@/lib/time";

export default function RfidEventsPage() {
  const { signOut, user } = useAuth();
  const { loading, error, report, filter, setFilter, originOptions, destOptions } =
    useRfidEventsReport();
  const [timeMode, setTimeMode] = useState<TimeMode>("utc");
  const [selectedS9, setSelectedS9] = useState<string | null>(null);

  const detail = useMemo(
    () => report.rows.find((r) => r.s9_id === selectedS9)?.all ?? [],
    [report, selectedS9]
  );

  return (
    <div className="p-4 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{strings.appTitle}</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{user?.email}</span>
          <Button variant="outline" size="sm" onClick={() => signOut()}>{strings.auth.signOut}</Button>
        </div>
      </header>

      <ReportFilters
        filter={filter}
        setFilter={setFilter}
        originOptions={originOptions}
        destOptions={destOptions}
        timeMode={timeMode}
        onTimeModeChange={setTimeMode}
      />

      {loading && <p className="text-sm text-muted-foreground">{strings.states.loading}</p>}
      {error && <p className="text-sm text-red-600">{strings.states.errorPrefix}{error}</p>}

      {!loading && !error && (
        <>
          <section className="border rounded-md overflow-auto">
            <RfidEventsPivot
              report={report}
              timeMode={timeMode}
              selectedS9={selectedS9}
              onSelectS9={setSelectedS9}
            />
          </section>
          <section className="border rounded-md overflow-auto">
            <h2 className="text-sm font-semibold p-2">{strings.states.eventDetails}</h2>
            <EventDetailsTable movements={detail} timeMode={timeMode} />
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Replace `leg2-reporting/src/App.tsx`**

```tsx
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import LoginPage from "@/pages/LoginPage";
import RfidEventsPage from "@/pages/RfidEventsPage";

function Gate() {
  const { session, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  return session ? <RfidEventsPage /> : <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
```

- [ ] **Step 8: Run the full test suite and typecheck**

Run: `pnpm --dir leg2-reporting test`
Expected: all suites pass (s9, checkpoints, time, supabase, pivot, filter, AuthContext, hook, pivot component, filters).
Run: `pnpm --dir leg2-reporting check`
Expected: no type errors.

- [ ] **Step 9: Build**

Run: `pnpm --dir leg2-reporting build`
Expected: `tsc` clean + Vite build writes `leg2-reporting/dist/`.

- [ ] **Step 10: Commit**

```bash
git add leg2-reporting/src/components/ReportFilters.tsx leg2-reporting/src/components/ReportFilters.test.tsx leg2-reporting/src/pages leg2-reporting/src/App.tsx
git commit -m "feat(leg2-reporting): filters bar, report page, login, auth-gated routing"
```

---

### Task 12: Grant read on the Leg2 view + live verification

**Files:**
- Create: `leg2-reporting/README.md` (run/deploy notes)

**Interfaces:**
- Consumes: the deployed view `vw_quicksight_rfid_report_movements` (Leg2).
- Produces: `authenticated` can `SELECT` the view; documented run steps.

- [ ] **Step 1: Confirm the target project before the write**

State to the user, verbatim: "Voy a ejecutar un GRANT en **Leg2 `ubgatxfwpmyaqyfrwias`**. ¿Confirmas?" Wait for explicit confirmation (CLAUDE.md anti-confusion rule). Do NOT proceed without it.

- [ ] **Step 2: Apply the grant (MCP `mcp__supabase-leg2__apply_migration`)**

Name: `grant_select_rfid_report_view_to_authenticated`
```sql
GRANT SELECT ON public.vw_quicksight_rfid_report_movements TO authenticated;
```

- [ ] **Step 3: Verify the grant landed**

Run (MCP `mcp__supabase-leg2__execute_sql`):
```sql
select grantee, privilege_type
from information_schema.role_table_grants
where table_name = 'vw_quicksight_rfid_report_movements'
  and table_schema = 'public'
  and grantee = 'authenticated';
```
Expected: one row `authenticated | SELECT`.

- [ ] **Step 4: Create `leg2-reporting/README.md`**

````markdown
# Leg2 RFID Reporting

Standalone SPA (Vite + React) for the IPC-style "RFID events" report, backed by
Supabase Leg2 (`ubgatxfwpmyaqyfrwias`).

## Run
```bash
pnpm --dir leg2-reporting install
pnpm --dir leg2-reporting dev      # http://localhost:3100
pnpm --dir leg2-reporting test
pnpm --dir leg2-reporting build    # -> leg2-reporting/dist
```

## Env (`leg2-reporting/.env.local`, not committed)
```
VITE_SUPABASE_URL=https://ubgatxfwpmyaqyfrwias.supabase.co
VITE_SUPABASE_ANON_KEY=<Leg2 publishable key>
```

## Data
- Reads `vw_quicksight_rfid_report_movements`. Requires
  `GRANT SELECT ... TO authenticated` on Leg2 (applied via migration
  `grant_select_rfid_report_view_to_authenticated`).
- Auth: Supabase Auth of Leg2. Create users in the Leg2 project.

## Deploy
Static SPA (like the legacy dashboard): serve `dist/` with an SPA fallback
`/* -> index.html`. Set the two `VITE_*` env vars at build time.
````

- [ ] **Step 5: Manual live check (dev server)**

Run: `pnpm --dir leg2-reporting dev`
In the browser at `http://localhost:3100`: sign in with a Leg2 user, confirm the
pivot renders with columns **Exit Outbound AMU (2320)** and **Entry Inbound AMU
(2400)**, switching Inbound/Outbound changes rows/columns, the UTC/Local toggle
changes displayed timestamps, and clicking a row fills Event details. Stop the
server when done.

- [ ] **Step 6: Commit**

```bash
git add leg2-reporting/README.md
git commit -m "docs(leg2-reporting): run/deploy notes; grant SELECT to authenticated on Leg2"
```

---

## Self-Review

**1. Spec coverage:**
- §3.1 view columns → Task 5 `RfidMovement` + `SELECT_COLS`. ✔
- §3.2 dynamic columns (numeric order, label fallback, earliest cell, null→no column) → Task 3 + Task 6. ✔
- §3.3 derivations (Po codes, Site, tab mapping) → Task 2 (Po/tab), Task 10 (Site `site_impc_code ?? centre_code`). ✔
- §4.1 location/stack → Task 1. ✔
- §4.2 browser-direct PostgREST + pagination → Task 5. ✔
- §4.3 Supabase Auth of Leg2 → Task 8 + Task 11. ✔
- §4.4 GRANT SELECT to authenticated → Task 12. ✔
- §5.1–5.4 layout, pivot, detail, filters → Tasks 10, 11. ✔
- §5.5 UTC/Local toggle + UTC-only duration → Task 4 (`durationHours`, `formatTimestamp`), wired in Tasks 10–11. ✔
- §6 file structure → Tasks 1–11 (note: `lib/time.ts` holds the duration helper; a dedicated duration view is v2). ✔
- §7 testing (pure logic + fetch + component smoke) → every task is TDD. ✔
- §3.4 terminology (RFID Reader/RFID Tag/Origin IMPC/…) → `strings.columns.*` in Task 1 §Step 9b, consumed by Tasks 10–11. ✔
- §4.5 i18n-readiness (single strings dictionary, no hardcoded UI text) → Task 1 `src/i18n/strings.ts`; every component imports `strings` (Tasks 10, 11); checkpoint names stay in `CHECKPOINT_LABELS` (Task 3). ✔
- §8 error handling (fetch throw w/ status, empty states, auth gate) → Task 5 (throw), Task 10/11 (empty states), Task 11 (gate). ✔

**2. Placeholder scan:** No TBD/TODO; every code step has complete code and exact commands. ✔

**3. Type consistency:** `RfidMovement` (Task 5) is the single row type consumed by Tasks 6/7/9/10. `ReportFilterState` (Task 7) consumed by Tasks 9/11. `RfidEventsReport`/`S9PivotRow` (Task 6) consumed by Tasks 9/10. `TimeMode` (Task 4) consumed by Tasks 10/11. `CheckpointColumn` (Task 3) consumed by Task 6. `Tab` (Task 2) consumed by Task 7. Names/signatures match across tasks. ✔

**Note on scope:** v1 does not render computed durations (v2), but the UTC-only
`durationHours` helper and its guard test are included so the hard rule is
locked in now (spec §5.5, §9).
```