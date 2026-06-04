/**
 * sync-site-snapshot — Supabase Edge Function (EDGE LEG2)
 * ======================================================
 * Refresca los MAESTROS desde GMS IOT (proyecto tsvlgznfvgoqbncunumu) ANTES del ETL:
 *   - public.readers_master -> public.rfid_reader_master_snapshot   (UPSERT por lpi)
 *   - public.sites          -> public.rfid_site_snapshot            (UPSERT por site_id)
 *
 * Por qué:
 *   El orquestador sólo LEE los snapshots; nada los refrescaba, así que quedaban
 *   desfasados (p.ej. EDI de Kawasaki a NULL en local pese a estar en GMS). Esta
 *   función mantiene ambos maestros al día en cada run, antes de enriquecer/transformar.
 *
 * EDI: readers_master.edi_equivalent_inbound/outbound es la fuente. Como rfid_site_snapshot
 *   guarda EDI a nivel de sitio (lo consume rfid_enrich_run), se agrega por site_id desde
 *   los lectores frescos de GMS (primer valor no nulo por sitio).
 *
 * Config (secretos de Edge Function): GMS_SITES_URL, GMS_SITES_KEY (anon key de GMS IOT).
 * Invocación: POST (cuerpo vacío). La llama el orquestador al inicio de cada run.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMS_URL = Deno.env.get("GMS_SITES_URL");
const GMS_KEY = Deno.env.get("GMS_SITES_KEY");

type Row = Record<string, unknown>;

function clean(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
function cc2(v: unknown): string | null {
  const t = clean(v);
  return t && t.length === 2 ? t : null;
}

async function gmsFetchAll(gmsUrl: string, gmsKey: string, table: string, select: string): Promise<Row[]> {
  const PAGE = 1000;
  let offset = 0;
  const out: Row[] = [];
  while (true) {
    const url = `${gmsUrl}/rest/v1/${table}?select=${select}&order=${table === "sites" ? "id" : "lpi"}.asc&limit=${PAGE}&offset=${offset}`;
    const resp = await fetch(url, {
      headers: { apikey: gmsKey, Authorization: `Bearer ${gmsKey}`, Accept: "application/json" },
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`GMS ${table} fetch ${resp.status}: ${body.slice(0, 300)}`);
    }
    const page = (await resp.json()) as Row[];
    out.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (!GMS_URL || !GMS_KEY) throw new Error("Missing GMS_SITES_URL / GMS_SITES_KEY function secrets");
    const now = new Date().toISOString();

    // ── 1. Lectores: GMS public.readers_master -> rfid_reader_master_snapshot ──
    const readers = await gmsFetchAll(GMS_URL, GMS_KEY, "readers_master", "*");
    const readerRows = readers.map((r) => ({
      lpi: r.lpi as string,
      site_id: clean(r.site_id),
      gate_id: clean(r.gate_id),
      reader_country_code: cc2(r.country_code),
      handover_point: (r.handover_point as boolean) ?? false,
      product: Array.isArray(r.product) ? (r.product as string[]) : null,
      raw_payload: r,
      snapshot_at_utc: now,
    })).filter((r) => r.lpi);

    let readersUpserted = 0;
    for (let i = 0; i < readerRows.length; i += 500) {
      const batch = readerRows.slice(i, i + 500);
      const { error } = await db.from("rfid_reader_master_snapshot").upsert(batch, { onConflict: "lpi" });
      if (error) throw new Error(`reader snapshot upsert failed: ${error.message}`);
      readersUpserted += batch.length;
    }

    // EDI por site_id desde los lectores frescos (primer no-nulo por sitio)
    const ediBySite = new Map<string, { in: string | null; out: string | null }>();
    for (const r of readers) {
      const sid = clean(r.site_id);
      if (!sid) continue;
      const cur = ediBySite.get(sid) ?? { in: null, out: null };
      ediBySite.set(sid, {
        in: cur.in ?? clean(r.edi_equivalent_inbound),
        out: cur.out ?? clean(r.edi_equivalent_outbound),
      });
    }

    // ── 2. Sitios: GMS public.sites -> rfid_site_snapshot ──
    const sites = await gmsFetchAll(
      GMS_URL,
      GMS_KEY,
      "sites",
      "id,site_impc,name,country_code,country_name,city,timezone",
    );
    const siteRows = sites.map((s) => {
      const edi = ediBySite.get(s.id as string) ?? { in: null, out: null };
      return {
        site_id: s.id as string,
        site_impc_code: clean(s.site_impc),
        site_name: clean(s.name),
        centre_code: null as string | null, // enrich coalesce -> site_impc_code
        country_code: cc2(s.country_code),
        country_name: clean(s.country_name),
        city: clean(s.city),
        timezone: clean(s.timezone),
        edi_equivalent_inbound: edi.in,
        edi_equivalent_outbound: edi.out,
        raw_payload: { _source: "gms_iot.public.sites", _synced_at: now, site: s },
        snapshot_at_utc: now,
      };
    }).filter((s) => s.site_id);

    let sitesUpserted = 0;
    for (let i = 0; i < siteRows.length; i += 500) {
      const batch = siteRows.slice(i, i + 500);
      const { error } = await db.from("rfid_site_snapshot").upsert(batch, { onConflict: "site_id" });
      if (error) throw new Error(`site_snapshot upsert failed: ${error.message}`);
      sitesUpserted += batch.length;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        readers_fetched: readers.length,
        readers_upserted: readersUpserted,
        sites_fetched: sites.length,
        sites_upserted: sitesUpserted,
        sites_with_edi: siteRows.filter((s) => s.edi_equivalent_inbound || s.edi_equivalent_outbound).length,
        synced_at: now,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
