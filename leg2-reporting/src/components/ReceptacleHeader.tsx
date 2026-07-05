import type { EdiDetail } from "@/lib/supabase";
import { deriveOrigPoCode, deriveDestPoCode } from "@/lib/s9";
import { strings } from "@/i18n/strings";

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

export function ReceptacleHeader({ s9, detail }: { s9: string; detail: EdiDetail | null }) {
  const t = strings.atat;
  return (
    <div className="border-b pb-4">
      <div className="font-mono text-lg font-semibold break-all">{s9}</div>
      {detail ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Pair label={t.origin} value={detail.origin_office ?? "—"} />
          <Pair label={t.destination} value={detail.destination_office ?? "—"} />
          <Pair label={t.mailCategory} value={detail.mail_category ?? "—"} />
          <Pair label={t.mailSubclass} value={detail.mail_subclass ?? "—"} />
          <Pair label={t.recNo} value={detail.rec_no ?? "—"} />
          <Pair label={t.grossWeight} value={detail.gross_weight ?? "—"} />
          <Pair label={t.items} value={detail.items ?? "—"} />
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-muted-foreground">{t.noDetail}</p>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Pair label={t.origin} value={deriveOrigPoCode(s9)} />
            <Pair label={t.destination} value={deriveDestPoCode(s9)} />
          </div>
        </div>
      )}
    </div>
  );
}
