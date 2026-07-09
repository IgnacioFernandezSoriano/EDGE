import type { Dispatch, SetStateAction } from "react";
import type { ReportFilterState } from "@/lib/filter";
import type { TimeMode } from "@/lib/time";
import { PRESET_ORDER, activePreset, type DateRange, type DatePreset } from "@/lib/datePresets";
import { strings } from "@/i18n/strings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const ALL = "__all__";

export function ReportFilters({
  filter,
  setFilter,
  originOptions,
  destOptions,
  hasIncidents,
  timeMode,
  onTimeModeChange,
  dateRange,
  onDateChange,
  onApplyPreset,
}: {
  filter: ReportFilterState;
  setFilter: Dispatch<SetStateAction<ReportFilterState>>;
  originOptions: string[];
  destOptions: string[];
  hasIncidents: boolean;
  timeMode: TimeMode;
  onTimeModeChange: (m: TimeMode) => void;
  dateRange: DateRange;
  onDateChange: (r: DateRange) => void;
  onApplyPreset: (p: DatePreset) => void;
}) {
  const active = activePreset(dateRange);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="date-from">{strings.filters.from}</Label>
            <Input
              id="date-from"
              type="date"
              value={dateRange.from}
              onChange={(e) => onDateChange({ ...dateRange, from: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="date-to">{strings.filters.to}</Label>
            <Input
              id="date-to"
              type="date"
              value={dateRange.to}
              onChange={(e) => onDateChange({ ...dateRange, to: e.target.value })}
            />
          </div>
          <div className="flex items-end gap-2">
            {PRESET_ORDER.map((p) => (
              <Button
                key={p}
                type="button"
                variant={active === p ? "default" : "outline"}
                aria-pressed={active === p}
                size="sm"
                onClick={() => onApplyPreset(p)}
              >
                {strings.datePresets[p]}
              </Button>
            ))}
          </div>
        </div>
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
        <div className="flex items-center gap-2 self-end pb-1">
          <Switch
            id="only-no-event-code"
            checked={filter.onlyNoEventCode}
            disabled={!hasIncidents}
            onCheckedChange={(c) =>
              setFilter((f) => ({ ...f, onlyNoEventCode: c }))
            }
          />
          <Label htmlFor="only-no-event-code">{strings.filters.onlyNoEventCode}</Label>
        </div>
      </div>
    </div>
  );
}
