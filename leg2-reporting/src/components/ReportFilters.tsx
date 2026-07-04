import type { Dispatch, SetStateAction } from "react";
import type { ReportFilterState } from "@/lib/filter";
import type { TimeMode } from "@/lib/time";
import { strings } from "@/i18n/strings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const ALL = "__all__";

export function ReportFilters({
  filter,
  setFilter,
  originOptions,
  destOptions,
  timeMode,
  onTimeModeChange,
}: {
  filter: ReportFilterState;
  setFilter: Dispatch<SetStateAction<ReportFilterState>>;
  originOptions: string[];
  destOptions: string[];
  timeMode: TimeMode;
  onTimeModeChange: (m: TimeMode) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Tabs
          value={filter.tab}
          onValueChange={(v) =>
            setFilter((f) => ({ ...f, tab: v as ReportFilterState["tab"] }))
          }
        >
          <TabsList>
            <TabsTrigger value="inbound">{strings.tabs.inbound}</TabsTrigger>
            <TabsTrigger value="outbound">{strings.tabs.outbound}</TabsTrigger>
          </TabsList>
        </Tabs>
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
      </div>
    </div>
  );
}
