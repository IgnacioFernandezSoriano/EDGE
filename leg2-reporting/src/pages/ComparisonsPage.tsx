import { useCallback, useEffect, useMemo, useState } from "react";
import {
  supabase, fetchEventComparisons, fetchComparisonEvents,
  createComparison, updateComparison, deleteComparison,
} from "@/lib/supabase";
import { eventFullLabel, type EventComparison, type EventVocabItem } from "@/lib/eventGaps";
import { strings } from "@/i18n/strings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

async function token(): Promise<{ token: string } | {}> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  return t ? { token: t } : {};
}

interface Draft { comparison_key: string; name: string; a: string; b: string; priority: number; }

function toDraft(c: EventComparison): Draft {
  return { comparison_key: c.comparison_key, name: c.name,
    a: `${c.a_source}|${c.a_code}`, b: `${c.b_source}|${c.b_code}`, priority: c.priority };
}
function fromDraft(d: Draft): EventComparison {
  const [a_source, a_code] = d.a.split("|");
  const [b_source, b_code] = d.b.split("|");
  return { comparison_key: d.comparison_key, name: d.name, a_source, a_code, b_source, b_code, priority: d.priority };
}

function EventSelect({ id, label, vocab, value, onChange }: {
  id: string; label: string; vocab: EventVocabItem[]; value: string; onChange: (v: string) => void;
}) {
  const rfid = vocab.filter((v) => v.source === "RFID");
  const edi = vocab.filter((v) => v.source === "EDI");
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} aria-label={label} className="border rounded h-9 px-2"
        value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        <optgroup label={strings.comparisons.rfidGroup}>
          {rfid.map((v) => <option key={v.code} value={`RFID|${v.code}`}>{eventFullLabel("RFID", v.code)}</option>)}
        </optgroup>
        <optgroup label={strings.comparisons.ediGroup}>
          {edi.map((v) => <option key={v.code} value={`EDI|${v.code}`}>{eventFullLabel("EDI", v.code)}</option>)}
        </optgroup>
      </select>
    </div>
  );
}

export default function ComparisonsPage() {
  const [rows, setRows] = useState<EventComparison[]>([]);
  const [vocab, setVocab] = useState<EventVocabItem[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await fetchEventComparisons(await token())); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let c = false;
    (async () => { try { const v = await fetchComparisonEvents(await token()); if (!c) setVocab(v); }
      catch (e) { if (!c) setError(e instanceof Error ? e.message : String(e)); } })();
    return () => { c = true; };
  }, []);

  const startAdd = () => setDraft({ comparison_key: crypto.randomUUID(), name: "", a: "", b: "",
    priority: (rows.reduce((m, r) => Math.max(m, r.priority), 0) + 1) });
  const save = async () => {
    if (!draft) return;
    const c = fromDraft(draft);
    const exists = rows.some((r) => r.comparison_key === c.comparison_key);
    try {
      if (exists) await updateComparison(c.comparison_key, c, await token());
      else await createComparison(c, await token());
      setDraft(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const remove = async (key: string) => {
    if (!window.confirm(strings.comparisons.confirmDelete)) return;
    try { await deleteComparison(key, await token()); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const sorted = useMemo(() => [...rows].sort((a, b) => a.priority - b.priority), [rows]);

  return (
    <div className="p-4 flex flex-col gap-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{strings.comparisons.title}</h2>
        <Button size="sm" onClick={startAdd}>{strings.comparisons.add}</Button>
      </div>
      {error && <p className="text-sm text-red-600">{strings.states.errorPrefix}{error}</p>}
      {sorted.length === 0 && <p className="text-sm text-muted-foreground">{strings.comparisons.empty}</p>}

      <ul className="flex flex-col gap-2">
        {sorted.map((c) => (
          <li key={c.comparison_key} className="flex items-center justify-between border rounded p-2">
            <div>
              <div className="font-medium">{c.name}</div>
              <div className="text-xs text-muted-foreground">
                {eventFullLabel(c.a_source, c.a_code)} → {eventFullLabel(c.b_source, c.b_code)} · #{c.priority}
              </div>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => setDraft(toDraft(c))}>{strings.comparisons.edit}</Button>
              <Button size="sm" variant="outline" onClick={() => remove(c.comparison_key)}>{strings.comparisons.remove}</Button>
            </div>
          </li>
        ))}
      </ul>

      {draft && (
        <div className="border rounded p-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="cmp-name">{strings.comparisons.name}</Label>
            <Input id="cmp-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <EventSelect id="cmp-a" label={strings.comparisons.eventA} vocab={vocab}
            value={draft.a} onChange={(v) => setDraft({ ...draft, a: v })} />
          <EventSelect id="cmp-b" label={strings.comparisons.eventB} vocab={vocab}
            value={draft.b} onChange={(v) => setDraft({ ...draft, b: v })} />
          {draft.a && draft.b && draft.a === draft.b && (
            <p className="text-sm text-red-600">{strings.comparisons.samePairWarning}</p>
          )}
          <div className="flex flex-col gap-1 w-32">
            <Label htmlFor="cmp-prio">{strings.comparisons.priority}</Label>
            <Input id="cmp-prio" type="number" value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) || 0 })} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={save}
              disabled={!draft.name || !draft.a || !draft.b || draft.a === draft.b}>{strings.comparisons.save}</Button>
            <Button size="sm" variant="outline" onClick={() => setDraft(null)}>{strings.comparisons.cancel}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
