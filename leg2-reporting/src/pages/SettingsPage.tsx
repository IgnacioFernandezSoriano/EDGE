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

  function reset() { setStatus("idle"); setResult(null); setMessage(""); }
  function pickScope(s: ReprocessScope) { setScope(s); setValue(null); reset(); }
  function pickValue(v: string) { setValue(v); reset(); }

  const scopeLabel =
    scope === "reader" ? strings.settings.scopeReader
    : scope === "site" ? strings.settings.scopeSite
    : strings.settings.scopeGlobal;
  const confirmTarget = scope === "global" ? strings.settings.confirmGlobalTarget : value ?? "";

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
            <Select value={value ?? undefined} onValueChange={pickValue}>
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
            <Select value={value ?? undefined} onValueChange={pickValue}>
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
