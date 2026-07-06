# Reprocess Control Panel (Settings screen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings screen with a reprocess/recalc control at three scopes (reader, site, global), backed by a new general `rfid-reprocess` edge function.

**Architecture:** New Deno edge function `rfid-reprocess` generalizes `rfid-reprocess-site` over a `scope` field, running `sync-site-snapshot → rfid_reprocess_scope(filter) → export-rfid-csv-to-s3`. A curated `vw_sites` view backs the site picker. A React `SettingsPage` (hash route `#/settings`, new nav item) drives it via a deps-injectable `triggerReprocess` client, gated by a confirm dialog.

**Tech Stack:** Deno (edge function) · Supabase Postgres (view + RPC) · React 19 + TS 5.6 + Vite 7 + Tailwind v4 · shadcn/ui (Dialog, Select, Button, Label) · Vitest + @testing-library/react (jsdom) · pnpm.

## Global Constraints

- **Project:** all DB/edge writes target EDGE Leg2 `ubgatxfwpmyaqyfrwias` ONLY. Confirm ref before any apply/deploy.
- **Edge function `verify_jwt = true`** (authenticated Leg2 users only), like `rfid-reprocess-site`.
- **`DATA_START = "2026-01-01T00:00:00Z"`** — reprocess always runs from this fixed start; no date input.
- **`p_max_reads: 100000`, `p_environment: "production"`, `p_reason: "settings_reprocess_<scope>"`.**
- **Response shape (edge + client):** `{ ok: boolean, status: string, movements_upserted: number, reprocess_run_id?: string, error?: string }`.
- **No RBAC / per-user scoping** (deferred). Any authenticated user may trigger any scope.
- **All user-facing copy in `src/i18n/strings.ts`, English**, under `strings.settings.*`.
- **TDD**: failing test → run (fail) → minimal impl → run (pass) → commit. Frequent commits. DRY, YAGNI.
- **Deps-injectable** client/pages (optional `deps`/props with real defaults) so tests avoid network.

---

### Task 1: Edge function request parser

**Files:**
- Create: `supabase/functions/rfid-reprocess/request.ts`
- Test: `supabase/functions/rfid-reprocess/request_test.ts`

**Interfaces:**
- Produces: `parseReprocessRequest(body: unknown): ParsedReprocessRequest` where
  `ParsedReprocessRequest = { ok: true; scope: "reader"; lpi: string } | { ok: true; scope: "site"; site_impc_code: string } | { ok: true; scope: "global" } | { ok: false; error: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/rfid-reprocess/request_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseReprocessRequest } from "./request.ts";

Deno.test("global needs no value", () => {
  assertEquals(parseReprocessRequest({ scope: "global" }), { ok: true, scope: "global" });
});

Deno.test("reader requires a non-empty lpi", () => {
  assertEquals(parseReprocessRequest({ scope: "reader", lpi: " ABC " }), { ok: true, scope: "reader", lpi: "ABC" });
  assertEquals(parseReprocessRequest({ scope: "reader", lpi: "  " }).ok, false);
  assertEquals(parseReprocessRequest({ scope: "reader" }).ok, false);
});

Deno.test("site requires a non-empty site_impc_code", () => {
  assertEquals(parseReprocessRequest({ scope: "site", site_impc_code: "INMUBA" }), { ok: true, scope: "site", site_impc_code: "INMUBA" });
  assertEquals(parseReprocessRequest({ scope: "site", site_impc_code: "" }).ok, false);
});

Deno.test("unknown or missing scope is rejected", () => {
  assertEquals(parseReprocessRequest({ scope: "everything" }).ok, false);
  assertEquals(parseReprocessRequest({}).ok, false);
  assertEquals(parseReprocessRequest(null).ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/rfid-reprocess/request_test.ts`
Expected: FAIL (module `./request.ts` not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// supabase/functions/rfid-reprocess/request.ts
export type ParsedReprocessRequest =
  | { ok: true; scope: "reader"; lpi: string }
  | { ok: true; scope: "site"; site_impc_code: string }
  | { ok: true; scope: "global" }
  | { ok: false; error: string };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function parseReprocessRequest(body: unknown): ParsedReprocessRequest {
  const b = (body ?? {}) as { scope?: unknown; lpi?: unknown; site_impc_code?: unknown };
  if (b.scope === "global") return { ok: true, scope: "global" };
  if (b.scope === "reader") {
    const lpi = str(b.lpi);
    return lpi ? { ok: true, scope: "reader", lpi } : { ok: false, error: "lpi is required for scope=reader" };
  }
  if (b.scope === "site") {
    const site = str(b.site_impc_code);
    return site ? { ok: true, scope: "site", site_impc_code: site } : { ok: false, error: "site_impc_code is required for scope=site" };
  }
  return { ok: false, error: "scope must be one of reader|site|global" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/rfid-reprocess/request_test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/rfid-reprocess/request.ts supabase/functions/rfid-reprocess/request_test.ts
git commit -m "feat(leg2): rfid-reprocess request parser (reader|site|global)"
```

---

### Task 2: Edge function handler + config

**Files:**
- Create: `supabase/functions/rfid-reprocess/index.ts`
- Modify: `supabase/config.toml` (append the function block)

**Interfaces:**
- Consumes: `parseReprocessRequest` (Task 1).
- Produces: `POST /functions/v1/rfid-reprocess` accepting `{ scope, lpi?, site_impc_code? }`, returning the Global-Constraints response shape.

Handler is transcription of the proven `rfid-reprocess-site` flow with a scope→filter switch; the logic under test is the parser (Task 1). No new Deno test.

- [ ] **Step 1: Write the handler**

```ts
// supabase/functions/rfid-reprocess/index.ts
/**
 * rfid-reprocess — Edge Function (EDGE LEG2)
 * General reprocess trigger at reader | site | global scope.
 * Flow: sync-site-snapshot -> rfid_reprocess_scope(filter) -> export CSV.
 * JWT-verified: only an authenticated Leg2 user can trigger it.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseReprocessRequest } from "./request.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DATA_START = "2026-01-01T00:00:00Z";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);

  const parsed = parseReprocessRequest(await req.json().catch(() => ({})));
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);

  const p_filters: Record<string, unknown> = { from: DATA_START };
  if (parsed.scope === "reader") p_filters.readers = [parsed.lpi];
  if (parsed.scope === "site") p_filters.sites = [parsed.site_impc_code];

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // 1) Refresh masters from GMS IOT so any external reader/site change lands first.
    const syncResp = await fetch(`${SUPABASE_URL}/functions/v1/sync-site-snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: "{}",
    });
    if (!syncResp.ok) {
      const t = await syncResp.text();
      return json({ ok: false, status: "sync_failed", movements_upserted: 0, error: t.slice(0, 300) }, 502);
    }

    // 2) Reprocess the scoped pairs.
    const { data, error } = await db.rpc("rfid_reprocess_scope", {
      p_filters,
      p_environment: "production",
      p_max_reads: 100000,
      p_reason: `settings_reprocess_${parsed.scope}`,
    });
    if (error) {
      return json({ ok: false, status: "reprocess_failed", movements_upserted: 0, error: error.message }, 500);
    }
    const row = Array.isArray(data) ? data[0] : data;

    // 3) Re-export CSV (non-blocking on failure — reprocess already committed).
    await fetch(`${SUPABASE_URL}/functions/v1/export-rfid-csv-to-s3`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: "{}",
    }).catch(() => {});

    return json({
      ok: row?.status === "success",
      status: row?.status ?? "unknown",
      movements_upserted: row?.movements_upserted ?? 0,
      reprocess_run_id: row?.reprocess_run_id,
      error: row?.status === "success" ? undefined : row?.error_message ?? undefined,
    });
  } catch (e) {
    return json({ ok: false, status: "error", movements_upserted: 0, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
```

- [ ] **Step 2: Append the config block**

Add to `supabase/config.toml` (after the `[functions.rfid-reprocess-site]` block):

```toml
# General reprocess trigger (reader|site|global) for the Settings screen.
[functions.rfid-reprocess]
verify_jwt = true
```

- [ ] **Step 3: Typecheck the function (best-effort)**

Run: `deno check supabase/functions/rfid-reprocess/index.ts`
Expected: no type errors. (If `deno` is unavailable, skip — parser is tested in Task 1.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/rfid-reprocess/index.ts supabase/config.toml
git commit -m "feat(leg2): rfid-reprocess edge function + config"
```

**NOTE (execution-time, not a code step):** deploying this function is a Leg2 write. During execution, confirm ref `ubgatxfwpmyaqyfrwias`, then deploy with the Supabase CLI (`supabase functions deploy rfid-reprocess --project-ref ubgatxfwpmyaqyfrwias`). It reuses the existing function secrets (SERVICE key, GMS secrets via sync-site-snapshot).

---

### Task 3: `vw_sites` view

**Files:**
- Create: `leg2-reporting/sql/vw_sites.sql`

**Interfaces:**
- Produces: view `public.vw_sites (site_impc_code, site_name, country_name)`, `grant select` to `authenticated`.

- [ ] **Step 1: Write the SQL**

```sql
-- vw_sites — curated site list for the Settings reprocess picker.
-- One row per site (incl. sites with no movements). Source: rfid_site_snapshot
-- (local mirror of GMS IOT sites, refreshed by sync-site-snapshot).
-- Applied on EDGE Leg2 (project ubgatxfwpmyaqyfrwias).
create or replace view public.vw_sites as
select site_impc_code, site_name, country_name
from public.rfid_site_snapshot
where site_impc_code is not null
order by site_impc_code;

grant select on public.vw_sites to authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add leg2-reporting/sql/vw_sites.sql
git commit -m "feat(leg2): vw_sites view for the reprocess site picker"
```

**NOTE (execution-time):** applying this view is a Leg2 write. During execution, confirm ref `ubgatxfwpmyaqyfrwias`, then apply the SQL (CLI or MCP). Verify: `select count(*) from public.vw_sites;` returns > 0 and an authenticated select succeeds.

---

### Task 4: `triggerReprocess` client

**Files:**
- Create: `leg2-reporting/src/lib/reprocess.ts`
- Test: `leg2-reporting/src/lib/reprocess.test.ts`

**Interfaces:**
- Produces: `type ReprocessScope = "reader" | "site" | "global"`; `interface ReprocessResult { ok: boolean; status: string; movements_upserted: number; reprocess_run_id?: string; error?: string }`; `triggerReprocess(scope: ReprocessScope, value: string | null, deps?): Promise<ReprocessResult>`.

- [ ] **Step 1: Write the failing test**

```ts
// leg2-reporting/src/lib/reprocess.test.ts
import { describe, it, expect, vi } from "vitest";
import { triggerReprocess } from "@/lib/reprocess";

const okResp = (body: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

describe("triggerReprocess", () => {
  it("posts scope=reader with lpi", async () => {
    const fetchFn = vi.fn(() => okResp({ ok: true, status: "success", movements_upserted: 3, reprocess_run_id: "r1" }));
    const res = await triggerReprocess("reader", "LPI-1", { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "http://fn/rfid-reprocess" });
    expect(res.movements_upserted).toBe(3);
    const [, init] = fetchFn.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ scope: "reader", lpi: "LPI-1" });
  });

  it("posts scope=site with site_impc_code", async () => {
    const fetchFn = vi.fn(() => okResp({ ok: true, status: "success", movements_upserted: 0 }));
    await triggerReprocess("site", "INMUBA", { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "http://fn/rfid-reprocess" });
    expect(JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)).toEqual({ scope: "site", site_impc_code: "INMUBA" });
  });

  it("posts scope=global with no value", async () => {
    const fetchFn = vi.fn(() => okResp({ ok: true, status: "success", movements_upserted: 10 }));
    await triggerReprocess("global", null, { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "http://fn/rfid-reprocess" });
    expect(JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)).toEqual({ scope: "global" });
  });

  it("returns an error result on non-ok HTTP", async () => {
    const fetchFn = vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "boom" }) } as Response));
    const res = await triggerReprocess("global", null, { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "http://fn/rfid-reprocess" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("boom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd leg2-reporting && pnpm vitest run src/lib/reprocess.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// leg2-reporting/src/lib/reprocess.ts
import { supabase } from "@/lib/supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export type ReprocessScope = "reader" | "site" | "global";

export interface ReprocessResult {
  ok: boolean;
  status: string;
  movements_upserted: number;
  reprocess_run_id?: string;
  error?: string;
}

type Deps = { fetchFn?: typeof fetch; token?: string; anonKey?: string; baseUrl?: string };

export async function triggerReprocess(
  scope: ReprocessScope,
  value: string | null,
  deps: Deps = {}
): Promise<ReprocessResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const anonKey = deps.anonKey ?? SUPABASE_ANON_KEY;
  let token = deps.token;
  if (!token) {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? anonKey;
  }
  const url = deps.baseUrl ?? `${SUPABASE_URL}/functions/v1/rfid-reprocess`;

  const body =
    scope === "reader" ? { scope, lpi: value ?? "" }
    : scope === "site" ? { scope, site_impc_code: value ?? "" }
    : { scope: "global" as const };

  const res = await fetchFn(url, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<ReprocessResult>;
  if (!res.ok) {
    return { ok: false, status: data.status ?? `http_${res.status}`, movements_upserted: 0, error: data.error ?? `HTTP ${res.status}` };
  }
  return {
    ok: data.ok ?? false,
    status: data.status ?? "unknown",
    movements_upserted: data.movements_upserted ?? 0,
    reprocess_run_id: data.reprocess_run_id,
    error: data.error,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd leg2-reporting && pnpm vitest run src/lib/reprocess.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/reprocess.ts leg2-reporting/src/lib/reprocess.test.ts
git commit -m "feat(leg2): triggerReprocess client for the reprocess panel"
```

---

### Task 5: `fetchSites` + `SiteOption`

**Files:**
- Modify: `leg2-reporting/src/lib/supabase.ts` (add type, cols, url builder, fetcher)
- Test: `leg2-reporting/src/lib/supabase.test.ts` (append cases)

**Interfaces:**
- Produces: `interface SiteOption { site_impc_code: string; site_name: string | null; country_name: string | null }`; `SITES_SELECT_COLS`; `buildSitesUrl(baseUrl, {offset, limit})`; `fetchSites(deps?): Promise<SiteOption[]>`.

- [ ] **Step 1: Write the failing test** (append to `supabase.test.ts`)

```ts
import { buildSitesUrl, fetchSites, SITES_SELECT_COLS } from "@/lib/supabase";

describe("buildSitesUrl", () => {
  it("selects from vw_sites ordered by code", () => {
    const url = buildSitesUrl("https://x.supabase.co/rest/v1/vw_sites", { offset: 0, limit: 1000 });
    expect(url).toContain("/vw_sites");
    expect(url).toContain(`select=${encodeURIComponent(SITES_SELECT_COLS)}`);
    expect(url).toContain("order=site_impc_code");
  });
});

describe("fetchSites", () => {
  it("returns rows from a single page", async () => {
    const rows = [{ site_impc_code: "INMUBA", site_name: "Mumbai", country_name: "India" }];
    const fetchFn = vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(""), json: () => Promise.resolve(rows) } as Response));
    const out = await fetchSites({ fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "https://x.supabase.co/rest/v1/vw_sites" });
    expect(out).toEqual(rows);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd leg2-reporting && pnpm vitest run src/lib/supabase.test.ts`
Expected: FAIL (`buildSitesUrl`/`fetchSites` not exported).

- [ ] **Step 3: Write minimal implementation** (add to `supabase.ts`, next to the reader-master fetchers)

```ts
export interface SiteOption {
  site_impc_code: string;
  site_name: string | null;
  country_name: string | null;
}

const SITES_VIEW = "vw_sites";
export const SITES_SELECT_COLS = ["site_impc_code", "site_name", "country_name"].join(",");

export function buildSitesUrl(baseUrl: string, opts: { offset: number; limit: number }): string {
  const url = new URL(baseUrl);
  url.searchParams.set("select", SITES_SELECT_COLS);
  url.searchParams.set("order", "site_impc_code");
  url.searchParams.set("offset", String(opts.offset));
  url.searchParams.set("limit", String(opts.limit));
  return url.toString();
}

export async function fetchSites(deps: FetchDeps = {}): Promise<SiteOption[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${SITES_VIEW}`;
  return fetchAllPages<SiteOption>(
    (offset, limit) => buildSitesUrl(baseUrl, { offset, limit }),
    fetchFn,
    headers,
    "Leg2 sites fetch"
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd leg2-reporting && pnpm vitest run src/lib/supabase.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/supabase.ts leg2-reporting/src/lib/supabase.test.ts
git commit -m "feat(leg2): fetchSites + SiteOption for the reprocess site picker"
```

---

### Task 6: `#/settings` route

**Files:**
- Modify: `leg2-reporting/src/lib/hashRoute.ts`
- Test: `leg2-reporting/src/lib/hashRoute.test.ts` (create if absent, else append)

**Interfaces:**
- Produces: `Route` union gains `| { name: "settings" }`; `parseHash("#/settings") → { name: "settings" }`.

- [ ] **Step 1: Write the failing test**

```ts
// leg2-reporting/src/lib/hashRoute.test.ts  (append if the file exists)
import { describe, it, expect } from "vitest";
import { parseHash } from "@/lib/hashRoute";

describe("parseHash settings", () => {
  it("parses #/settings", () => {
    expect(parseHash("#/settings")).toEqual({ name: "settings" });
  });
  it("still parses receptacle and defaults to report", () => {
    expect(parseHash("#/receptacle/ABC")).toEqual({ name: "receptacle", s9: "ABC" });
    expect(parseHash("#/")).toEqual({ name: "report" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd leg2-reporting && pnpm vitest run src/lib/hashRoute.test.ts`
Expected: FAIL (`#/settings` returns `{ name: "report" }`).

- [ ] **Step 3: Write minimal implementation**

Edit `hashRoute.ts`:

```ts
export type Route = { name: "report" } | { name: "receptacle"; s9: string } | { name: "settings" };

const RECEPTACLE_RE = /^#\/receptacle(?:\/(.*))?$/;

export function parseHash(hash: string): Route {
  if (hash === "#/settings") return { name: "settings" };
  const m = RECEPTACLE_RE.exec(hash);
  if (m) {
    const s9 = decodeURIComponent(m[1] ?? "").trim();
    return { name: "receptacle", s9 };
  }
  return { name: "report" };
}

export function receptacleHash(s9: string): string {
  return `#/receptacle/${encodeURIComponent(s9.trim())}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd leg2-reporting && pnpm vitest run src/lib/hashRoute.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/hashRoute.ts leg2-reporting/src/lib/hashRoute.test.ts
git commit -m "feat(leg2): #/settings hash route"
```

---

### Task 7: `SettingsPage` component + strings

**Files:**
- Create: `leg2-reporting/src/pages/SettingsPage.tsx`
- Modify: `leg2-reporting/src/i18n/strings.ts` (add `settings` block)
- Test: `leg2-reporting/src/pages/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: `triggerReprocess`, `ReprocessScope`, `ReprocessResult` (Task 4); `fetchSites`, `SiteOption`, `fetchReaderMaster`, `ReaderMaster` (Task 5 + existing); shadcn `Dialog`, `Select`, `Button`, `Label`.
- Produces: `default export function SettingsPage(props?: { deps?: SettingsDeps })` where `SettingsDeps = { triggerReprocessFn?, fetchReadersFn?, fetchSitesFn? }` (real defaults). Renders a scope selector, scope-specific picker, a confirm dialog, and result feedback.

- [ ] **Step 1: Add the strings block** (`strings.ts`, inside the root object)

```ts
  settings: {
    nav: "Settings",
    reprocessTitle: "Reprocess / Recalculate",
    reprocessHelp: "Refresh masters from GMS and rebuild the report + CSV for the chosen scope.",
    scope: "Scope",
    scopeReader: "Reader",
    scopeSite: "Site",
    scopeGlobal: "Global",
    selectReader: "Select a reader (LPI)",
    selectSite: "Select a site",
    globalWarning: "Global rebuilds ALL movements from the data start — heavy, full-history.",
    recalc: "Recalculate",
    running: "Recalculating…",
    confirmTitle: "Confirm reprocess",
    confirmBody: "This rewrites production movements and re-exports the QuickSight CSV. Continue?",
    confirm: "Yes, recalculate",
    cancel: "Cancel",
    donePrefix: "Done — movements upserted: ",
    runId: "Run id: ",
    errorPrefix: "Error: ",
  },
```

- [ ] **Step 2: Write the failing test**

```tsx
// leg2-reporting/src/pages/SettingsPage.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPage from "@/pages/SettingsPage";
import { strings } from "@/i18n/strings";

const deps = (over = {}) => ({
  triggerReprocessFn: vi.fn(async () => ({ ok: true, status: "success", movements_upserted: 7, reprocess_run_id: "run-1" })),
  fetchReadersFn: vi.fn(async () => [{ lpi: "LPI-1", facility_name: "Sao Paulo", handover_point: false } as never]),
  fetchSitesFn: vi.fn(async () => [{ site_impc_code: "BRSAOA", site_name: "Sao Paulo", country_name: "Brazil" }]),
  ...over,
});

describe("SettingsPage", () => {
  it("global: recalc opens confirm, confirm calls triggerReprocess and shows result", async () => {
    const d = deps();
    render(<SettingsPage deps={d} />);
    await userEvent.click(screen.getByText(strings.settings.scopeGlobal));
    await userEvent.click(screen.getByRole("button", { name: strings.settings.recalc }));
    // confirm dialog
    await userEvent.click(screen.getByRole("button", { name: strings.settings.confirm }));
    await waitFor(() => expect(d.triggerReprocessFn).toHaveBeenCalledWith("global", null));
    expect(await screen.findByText(/movements upserted: 7/i)).toBeInTheDocument();
  });

  it("site: recalc button disabled until a site is chosen", async () => {
    const d = deps();
    render(<SettingsPage deps={d} />);
    await userEvent.click(screen.getByText(strings.settings.scopeSite));
    expect(screen.getByRole("button", { name: strings.settings.recalc })).toBeDisabled();
  });

  it("surfaces an error result", async () => {
    const d = deps({ triggerReprocessFn: vi.fn(async () => ({ ok: false, status: "reprocess_failed", movements_upserted: 0, error: "boom" })) });
    render(<SettingsPage deps={d} />);
    await userEvent.click(screen.getByText(strings.settings.scopeGlobal));
    await userEvent.click(screen.getByRole("button", { name: strings.settings.recalc }));
    await userEvent.click(screen.getByRole("button", { name: strings.settings.confirm }));
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd leg2-reporting && pnpm vitest run src/pages/SettingsPage.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Write the implementation**

```tsx
// leg2-reporting/src/pages/SettingsPage.tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  triggerReprocess as realTrigger, type ReprocessScope, type ReprocessResult,
} from "@/lib/reprocess";
import {
  fetchReaderMaster as realFetchReaders, fetchSites as realFetchSites,
  type ReaderMaster, type SiteOption,
} from "@/lib/supabase";
import { strings } from "@/i18n/strings";

export type SettingsDeps = {
  triggerReprocessFn?: (scope: ReprocessScope, value: string | null) => Promise<ReprocessResult>;
  fetchReadersFn?: () => Promise<ReaderMaster[]>;
  fetchSitesFn?: () => Promise<SiteOption[]>;
};

type Status = "idle" | "running" | "done" | "error";

export default function SettingsPage({ deps = {} }: { deps?: SettingsDeps }) {
  const trigger = deps.triggerReprocessFn ?? ((s, v) => realTrigger(s, v));
  const loadReaders = deps.fetchReadersFn ?? (() => realFetchReaders());
  const loadSites = deps.fetchSitesFn ?? (() => realFetchSites());

  const [scope, setScope] = useState<ReprocessScope>("site");
  const [readers, setReaders] = useState<ReaderMaster[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [value, setValue] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ReprocessResult | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => { loadSites().then(setSites).catch(() => {}); loadReaders().then(setReaders).catch(() => {}); /* eslint-disable-next-line */ }, []);

  const needsValue = scope !== "global";
  const canRun = !needsValue || (value != null && value !== "");

  function pickScope(s: ReprocessScope) { setScope(s); setValue(null); setStatus("idle"); setResult(null); setMessage(""); }

  async function run() {
    setConfirmOpen(false);
    setStatus("running");
    setMessage("");
    try {
      const res = await trigger(scope, needsValue ? value : null);
      setResult(res);
      if (res.ok) { setStatus("done"); setMessage(`${strings.settings.donePrefix}${res.movements_upserted}`); }
      else { setStatus("error"); setMessage(`${strings.settings.errorPrefix}${res.error ?? res.status}`); }
    } catch (e) {
      setStatus("error");
      setMessage(`${strings.settings.errorPrefix}${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      <div className="rounded-lg border p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{strings.settings.reprocessTitle}</h2>
          <p className="text-sm text-muted-foreground">{strings.settings.reprocessHelp}</p>
        </div>

        <div className="space-y-2">
          <Label>{strings.settings.scope}</Label>
          <div className="flex gap-1">
            {([["reader", strings.settings.scopeReader], ["site", strings.settings.scopeSite], ["global", strings.settings.scopeGlobal]] as const).map(([s, label]) => (
              <Button key={s} size="sm" variant={scope === s ? "default" : "outline"} onClick={() => pickScope(s)}>{label}</Button>
            ))}
          </div>
        </div>

        {scope === "reader" && (
          <div className="space-y-1">
            <Label>{strings.settings.selectReader}</Label>
            <Select value={value ?? undefined} onValueChange={setValue}>
              <SelectTrigger><SelectValue placeholder={strings.settings.selectReader} /></SelectTrigger>
              <SelectContent>
                {readers.map((r) => (
                  <SelectItem key={r.lpi} value={r.lpi}>{r.lpi}{r.facility_name ? ` — ${r.facility_name}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {scope === "site" && (
          <div className="space-y-1">
            <Label>{strings.settings.selectSite}</Label>
            <Select value={value ?? undefined} onValueChange={setValue}>
              <SelectTrigger><SelectValue placeholder={strings.settings.selectSite} /></SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={s.site_impc_code} value={s.site_impc_code}>{s.site_impc_code}{s.site_name ? ` — ${s.site_name}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {scope === "global" && (
          <p className="text-sm text-amber-700">{strings.settings.globalWarning}</p>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={() => setConfirmOpen(true)} disabled={!canRun || status === "running"}>
            {status === "running" ? strings.settings.running : strings.settings.recalc}
          </Button>
          {message && (
            <span className={status === "error" ? "text-sm text-red-600" : "text-sm text-green-700"}>{message}</span>
          )}
          {result?.reprocess_run_id && status === "done" && (
            <span className="text-xs text-muted-foreground">{strings.settings.runId}{result.reprocess_run_id}</span>
          )}
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{strings.settings.confirmTitle}</DialogTitle></DialogHeader>
          <p className="text-sm">{strings.settings.confirmBody}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>{strings.settings.cancel}</Button>
            <Button onClick={run}>{strings.settings.confirm}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd leg2-reporting && pnpm vitest run src/pages/SettingsPage.test.tsx`
Expected: PASS (3 tests). (If `DialogFooter` is not exported by `components/ui/dialog`, use a plain `<div className="flex justify-end gap-2">` instead — verify the export before writing.)

- [ ] **Step 6: Commit**

```bash
git add leg2-reporting/src/pages/SettingsPage.tsx leg2-reporting/src/i18n/strings.ts leg2-reporting/src/pages/SettingsPage.test.tsx
git commit -m "feat(leg2): SettingsPage reprocess panel (scope + confirm + result)"
```

---

### Task 8: Wire nav + route in `App.tsx`

**Files:**
- Modify: `leg2-reporting/src/App.tsx`
- Test: `leg2-reporting/src/App.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `SettingsPage` (Task 7), `parseHash`/`Route` with `settings` (Task 6), `strings.settings.nav` (Task 7).

- [ ] **Step 1: Write the failing test**

```tsx
// leg2-reporting/src/App.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/contexts/AuthContext", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/contexts/AuthContext");
  return {
    ...actual,
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAuth: () => ({ session: { user: { email: "t@t" } }, user: { email: "t@t" }, isLoading: false, signOut: vi.fn() }),
  };
});
vi.mock("@/pages/SettingsPage", () => ({ default: () => <div>SETTINGS_PAGE</div> }));
vi.mock("@/pages/RfidEventsPage", () => ({ default: () => <div>REPORT_PAGE</div> }));
vi.mock("@/pages/AtatPage", () => ({ default: () => <div>ATAT_PAGE</div> }));

import App from "@/App";
import { strings } from "@/i18n/strings";

describe("App settings route", () => {
  beforeEach(() => { window.location.hash = ""; });
  it("shows the Settings nav item", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: strings.settings.nav })).toBeInTheDocument();
  });
  it("renders SettingsPage at #/settings", () => {
    window.location.hash = "#/settings";
    render(<App />);
    expect(screen.getByText("SETTINGS_PAGE")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd leg2-reporting && pnpm vitest run src/App.test.tsx`
Expected: FAIL (no Settings nav / route).

- [ ] **Step 3: Write the implementation**

In `App.tsx`: import `SettingsPage`; add a nav button; render for the settings route.

```tsx
import SettingsPage from "@/pages/SettingsPage";
```

Add to `Nav` (after the receptacle button):

```tsx
      <Button
        variant={route.name === "settings" ? "default" : "outline"}
        size="sm"
        onClick={() => go("#/settings")}
      >
        {strings.settings.nav}
      </Button>
```

Replace the route render block in `Gate`:

```tsx
        {route.name === "settings"
          ? <SettingsPage />
          : route.name === "receptacle"
            ? <AtatPage s9={route.s9 || null} />
            : <RfidEventsPage />}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd leg2-reporting && pnpm vitest run src/App.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full suite + build**

Run: `cd leg2-reporting && pnpm vitest run && pnpm tsc -b && pnpm build`
Expected: all tests green, no type errors, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add leg2-reporting/src/App.tsx leg2-reporting/src/App.test.tsx
git commit -m "feat(leg2): wire Settings nav + route"
```

---

## Post-implementation (execution-time, outside the task loop)

These are Leg2 writes — confirm ref `ubgatxfwpmyaqyfrwias` before each:

1. Apply `leg2-reporting/sql/vw_sites.sql` to Leg2; verify `select count(*) from vw_sites` > 0.
2. Deploy the edge function: `supabase functions deploy rfid-reprocess --project-ref ubgatxfwpmyaqyfrwias`.
3. Manual smoke: sign in, open **Settings**, run a **Site** reprocess for a small site (e.g. `TRISTF`), confirm `movements_upserted` returns and the CSV re-exports.

## Self-Review notes

- Spec coverage: §2 edge fn → Tasks 1-2; §3 view → Task 3; §4 client → Tasks 4-5; §5 UI → Tasks 6-8; §7 testing → each task's tests. All covered.
- Type consistency: `ReprocessResult`/`ReprocessScope` (Task 4) reused in Tasks 7; `SiteOption` (Task 5) in Task 7; `Route.settings` (Task 6) in Task 8.
- Verify before writing: confirm `DialogFooter` export in `components/ui/dialog` (Task 7 fallback noted); confirm `Select` supports the used sub-components (it does — used in `ReaderEditorDialog`).
