import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { ReaderMaster } from "@/lib/supabase";
import { ediCodeOptions } from "@/lib/ediCodes";
import { optionsWithCurrent, READING_DIRECTIONS, OPERATIONS_SCOPES } from "@/lib/selectOptions";
import { applyReaderEdit, type ReaderOperation } from "@/lib/readerEdit";
import { strings } from "@/i18n/strings";

type Status = "idle" | "saving" | "done" | "error";
const EMPTY = "__empty__";

function opFromReader(r: ReaderMaster): Required<ReaderOperation> {
  return {
    gate_purpose: r.gate_purpose ?? "",
    edi_equivalent_inbound: r.edi_equivalent_inbound ?? "",
    edi_equivalent_outbound: r.edi_equivalent_outbound ?? "",
    handover_point: r.handover_point ?? false,
    reading_direction: r.reading_direction ?? "",
    operations_scope: r.operations_scope ?? "",
  };
}

function ReadOnlyRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value == null || value === "" ? "—" : String(value)}</span>
    </div>
  );
}

export function ReaderEditorDialog({
  open, onOpenChange, reader, onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reader: ReaderMaster | null;
  onApplied: () => void;
}) {
  const [op, setOp] = useState<Required<ReaderOperation>>(
    reader ? opFromReader(reader) : opFromReader({} as ReaderMaster)
  );
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (reader) {
      setOp(opFromReader(reader));
      setStatus("idle");
      setMessage("");
    }
  }, [reader]);

  if (!reader) return null;
  const inboundOpts = ediCodeOptions(reader.edi_equivalent_inbound ?? null);
  const outboundOpts = ediCodeOptions(reader.edi_equivalent_outbound ?? null);
  const rdOpts = optionsWithCurrent(READING_DIRECTIONS, reader.reading_direction ?? null);
  const osOpts = optionsWithCurrent(OPERATIONS_SCOPES, reader.operations_scope ?? null);

  async function handleSave() {
    if (!reader) return;
    setStatus("saving");
    setMessage("");
    try {
      const res = await applyReaderEdit(reader.lpi, op);
      if (!res.ok) throw new Error(res.error ?? res.status);
      setStatus("done");
      setMessage(strings.readerEditor.applied);
      onApplied();
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{strings.readerEditor.title}: {reader.lpi}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6">
          <section className="space-y-1">
            <h3 className="text-sm font-semibold">{strings.readerEditor.identification}</h3>
            <ReadOnlyRow label={strings.columns.rfidReader} value={reader.lpi} />
            <ReadOnlyRow label={strings.columns.gate} value={reader.gate_name} />
            <ReadOnlyRow label={strings.readerEditor.facility} value={reader.facility_name} />
            <ReadOnlyRow label={strings.readerEditor.facilityType} value={reader.facility_type} />
            <ReadOnlyRow label={strings.readerEditor.country} value={reader.country_name ?? reader.reader_country_code} />
            <ReadOnlyRow label={strings.readerEditor.city} value={reader.city} />
            <ReadOnlyRow label={strings.readerEditor.operator} value={reader.operator} />
            <ReadOnlyRow label={strings.readerEditor.inactive} value={reader.inactive} />
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{strings.readerEditor.operation}</h3>
            <div className="space-y-1">
              <Label>{strings.readerEditor.gatePurpose}</Label>
              <Input
                value={op.gate_purpose ?? ""}
                onChange={(e) => setOp((o) => ({ ...o, gate_purpose: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>{strings.readerEditor.inboundCode}</Label>
              <Select
                value={op.edi_equivalent_inbound || EMPTY}
                onValueChange={(v) => setOp((o) => ({ ...o, edi_equivalent_inbound: v === EMPTY ? "" : v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {inboundOpts.map((o) => (
                    <SelectItem key={o.value || EMPTY} value={o.value || EMPTY}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{strings.readerEditor.outboundCode}</Label>
              <Select
                value={op.edi_equivalent_outbound || EMPTY}
                onValueChange={(v) => setOp((o) => ({ ...o, edi_equivalent_outbound: v === EMPTY ? "" : v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {outboundOpts.map((o) => (
                    <SelectItem key={o.value || EMPTY} value={o.value || EMPTY}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="ho"
                checked={op.handover_point}
                onCheckedChange={(c) => setOp((o) => ({ ...o, handover_point: c }))}
              />
              <Label htmlFor="ho">{strings.readerEditor.handoverPoint}</Label>
            </div>
            <div className="space-y-1">
              <Label>{strings.readerEditor.readingDirection}</Label>
              <Select
                value={op.reading_direction || EMPTY}
                onValueChange={(v) => setOp((o) => ({ ...o, reading_direction: v === EMPTY ? "" : v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {rdOpts.map((o) => (
                    <SelectItem key={o.value || EMPTY} value={o.value || EMPTY}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{strings.readerEditor.operationsScope}</Label>
              <Select
                value={op.operations_scope || EMPTY}
                onValueChange={(v) => setOp((o) => ({ ...o, operations_scope: v === EMPTY ? "" : v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {osOpts.map((o) => (
                    <SelectItem key={o.value || EMPTY} value={o.value || EMPTY}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={status === "saving"}>
            {status === "saving" ? strings.readerEditor.saving : strings.readerEditor.save}
          </Button>
          {message && (
            <span className={status === "error" ? "text-red-600 text-sm" : "text-green-700 text-sm"}>
              {message}
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
