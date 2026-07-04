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
