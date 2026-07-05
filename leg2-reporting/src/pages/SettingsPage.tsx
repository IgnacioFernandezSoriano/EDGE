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
  triggerReprocess as realTrigger, fetchReprocessStatus as realFetchStatus,
  reprocessReason, REPROCESS_TERMINAL,
  type ReprocessScope, type ReprocessResult, type ReprocessStatus,
} from "@/lib/reprocess";
import {
  fetchReaderOptions as realFetchReaders, fetchSites as realFetchSites,
  supabase, type ReaderOption, type SiteOption,
} from "@/lib/supabase";
import { strings } from "@/i18n/strings";

async function sessionToken(): Promise<string | undefined> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type SettingsDeps = {
  triggerReprocessFn?: (scope: ReprocessScope, value: string | null, token?: string) => Promise<ReprocessResult>;
  fetchReadersFn?: () => Promise<ReaderOption[]>;
  fetchSitesFn?: () => Promise<SiteOption[]>;
  fetchStatusFn?: (reason: string) => Promise<ReprocessStatus | null>;
  makeToken?: () => string;
  pollMs?: number;
  maxMs?: number;
};

type Status = "idle" | "running" | "done" | "error";

export default function SettingsPage({ deps = {} }: { deps?: SettingsDeps }) {
  const trigger = deps.triggerReprocessFn ?? ((s, v, tok) => realTrigger(s, v, { reprocessToken: tok }));
  const loadReaders = deps.fetchReadersFn ?? (async () => realFetchReaders({ token: await sessionToken() }));
  const loadSites = deps.fetchSitesFn ?? (async () => realFetchSites({ token: await sessionToken() }));
  const fetchStatus = deps.fetchStatusFn ?? (async (reason: string) => realFetchStatus(reason, { token: await sessionToken() }));
  const genToken = deps.makeToken ?? (() => globalThis.crypto?.randomUUID?.() ?? `t${Date.now()}-${Math.round(Math.random() * 1e9)}`);
  const pollMs = deps.pollMs ?? 3000;
  const maxMs = deps.maxMs ?? 6 * 60 * 1000;

  const [scope, setScope] = useState<ReprocessScope>("site");
  const [readers, setReaders] = useState<ReaderOption[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [value, setValue] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ReprocessResult | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => { loadSites().then(setSites).catch(() => {}); loadReaders().then(setReaders).catch(() => {}); /* eslint-disable-next-line */ }, []);

  const needsValue = scope !== "global";
  const canRun = !needsValue || (value != null && value !== "");

  function reset() { setStatus("idle"); setResult(null); setMessage(""); }
  function pickScope(s: ReprocessScope) { setScope(s); setValue(null); reset(); }
  function pickValue(v: string) { setValue(v); reset(); }

  const scopeLabel =
    scope === "reader" ? strings.settings.scopeReader
    : scope === "site" ? strings.settings.scopeSite
    : strings.settings.scopeGlobal;
  const confirmTarget = scope === "global" ? strings.settings.confirmGlobalTarget : value ?? "";

  function finishRun(runStatus: string, movements: number, runId?: string, err?: string) {
    setResult({ ok: runStatus === "success", status: runStatus, movements_upserted: movements, reprocess_run_id: runId });
    if (runStatus === "success") { setStatus("done"); setMessage(`${strings.settings.donePrefix}${movements}`); }
    else if (runStatus === "skipped_empty") { setStatus("done"); setMessage(strings.settings.nothingToDo); }
    else if (runStatus === "skipped_locked") { setStatus("error"); setMessage(strings.settings.anotherRunning); }
    else { setStatus("error"); setMessage(`${strings.settings.errorPrefix}${err ?? runStatus}`); }
  }

  async function run() {
    setConfirmOpen(false);
    setStatus("running");
    setMessage("");
    setResult(null);
    const token = genToken();
    const reason = reprocessReason(scope, token);
    const v = needsValue ? value : null;

    // Fire the reprocess (a long job). Keep the promise so a fast, direct answer
    // (e.g. skipped_empty, or an immediate error) is honoured; the outcome of a
    // long run is read from the audit poll below. (Holder object so the closure
    // assignment is visible to the loop's reads.)
    const box: { fast: ReprocessResult | null } = { fast: null };
    trigger(scope, v, token).then((r) => { box.fast = r; }).catch(() => {});

    const startMs = Date.now();
    while (Date.now() - startMs < maxMs) {
      const f = box.fast;
      if (f && REPROCESS_TERMINAL.has(f.status)) {
        finishRun(f.status, f.movements_upserted, f.reprocess_run_id, f.error);
        return;
      }
      const st = await fetchStatus(reason).catch(() => null);
      if (st && REPROCESS_TERMINAL.has(st.status)) {
        finishRun(st.status, st.movements_upserted ?? 0, st.reprocess_run_id, st.error_message ?? undefined);
        return;
      }
      await sleep(pollMs);
    }
    // Gave up waiting — the run keeps going on the server.
    setStatus("error");
    setMessage(strings.settings.stillRunning);
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
            <Select value={value ?? undefined} onValueChange={pickValue}>
              <SelectTrigger><SelectValue placeholder={strings.settings.selectReader} /></SelectTrigger>
              <SelectContent>
                {readers.map((r) => (
                  <SelectItem key={r.reader_id} value={r.reader_id}>{r.reader_id}{r.facility_name ? ` — ${r.facility_name}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {scope === "site" && (
          <div className="space-y-1">
            <Label>{strings.settings.selectSite}</Label>
            <Select value={value ?? undefined} onValueChange={pickValue}>
              <SelectTrigger><SelectValue placeholder={strings.settings.selectSite} /></SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={s.centre_code} value={s.centre_code}>{s.site_name ?? s.centre_code}{s.country_code ? ` (${s.country_code})` : ""}</SelectItem>
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

        {status === "running" && (
          <div className="space-y-1" role="status" aria-live="polite">
            <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
              <div className="h-full w-full animate-pulse rounded bg-primary/60" />
            </div>
            <p className="text-xs text-muted-foreground">{strings.settings.runningNote}</p>
          </div>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{strings.settings.confirmTitle}</DialogTitle></DialogHeader>
          <p className={`text-sm font-medium ${scope === "global" ? "text-amber-700" : ""}`}>
            {strings.settings.confirmScopePrefix}{scopeLabel} — {confirmTarget}
          </p>
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
