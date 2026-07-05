import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ReaderMaster, RfidMovement } from "@/lib/supabase";
import { buildReaderMasterUrl } from "@/lib/gms";
import { reprocessSite } from "@/lib/reprocess";
import { strings } from "@/i18n/strings";

type Status = "idle" | "running" | "done" | "warn" | "error";

export function CorrectionDialog({
  open, onOpenChange, movements, readerMap,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  movements: RfidMovement[];
  readerMap: Map<string, ReaderMaster>;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  // Distinct readers (by LPI) behind this gap cell, and the sites to reprocess.
  const distinct = Array.from(
    new Map(movements.map((m) => [m.reader_id, m])).values()
  );
  const sites = Array.from(
    new Set(movements.map((m) => m.site_impc_code).filter((s): s is string => !!s))
  );

  async function handleReprocess() {
    setStatus("running");
    setMessage("");
    try {
      for (const site of sites) {
        const res = await reprocessSite(site);
        if (res.ok) continue;
        if (res.status === "skipped_empty" || res.status === "skipped_locked") {
          setStatus("warn");
          setMessage(strings.correction.reprocessSkipped);
          return;
        }
        throw new Error(res.error ?? res.status);
      }
      setStatus("done");
      setMessage(strings.correction.reprocessDone);
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.correction.title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{strings.correction.help}</p>
        <ul className="space-y-3">
          {distinct.map((m) => {
            const reader = readerMap.get(m.reader_id);
            return (
              <li key={m.reader_id} className="border rounded-md p-3 text-sm space-y-1">
                <div>
                  <span className="text-muted-foreground">{strings.columns.site}: </span>
                  {m.site_impc_code ?? "—"}
                  {m.country_code ? ` (${m.country_code})` : ""}
                </div>
                <div>
                  <span className="text-muted-foreground">{strings.columns.gate}: </span>
                  {reader?.gate_name ?? "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">{strings.columns.rfidReader}: </span>
                  <span className="font-mono">{m.reader_id}</span>
                </div>
                <a
                  className="text-blue-600 underline"
                  href={buildReaderMasterUrl(m.reader_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {strings.correction.openInMaster}
                </a>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-3">
          <Button onClick={handleReprocess} disabled={status === "running" || sites.length === 0}>
            {status === "running" ? strings.correction.reprocessing : strings.correction.reprocess}
          </Button>
          {message && (
            <span
              className={
                status === "error"
                  ? "text-red-600 text-sm"
                  : status === "warn"
                    ? "text-amber-700 text-sm"
                    : "text-green-700 text-sm"
              }
            >
              {message}
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
