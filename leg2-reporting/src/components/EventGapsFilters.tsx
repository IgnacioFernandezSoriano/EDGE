import { PRESET_ORDER, type DateRange, type DatePreset } from "@/lib/datePresets";
import { PRODUCT_ALL, PRODUCT_NONE, type Granularity, type GapUnit, type MailCategory } from "@/lib/eventGaps";
import { strings } from "@/i18n/strings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const ALL_COUNTRY = "__all__";

export interface EventGapsFiltersProps {
  dateRange: DateRange;
  onDateChange: (r: DateRange) => void;
  onApplyPreset: (p: DatePreset) => void;
  product: string;
  onProductChange: (p: string) => void;
  productOptions: MailCategory[];
  originCountry: string;
  destCountry: string;
  onOriginCountryChange: (c: string) => void;
  onDestCountryChange: (c: string) => void;
  countryOptions: string[];
  granularity: Granularity;
  onGranularityChange: (g: Granularity) => void;
  unit: GapUnit;
  onUnitChange: (u: GapUnit) => void;
}

export function EventGapsFilters({
  dateRange, onDateChange, onApplyPreset,
  product, onProductChange, productOptions,
  originCountry, destCountry, onOriginCountryChange, onDestCountryChange, countryOptions,
  granularity, onGranularityChange,
  unit, onUnitChange,
}: EventGapsFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="gaps-from">{strings.filters.from}</Label>
        <Input id="gaps-from" type="date" value={dateRange.from}
          onChange={(e) => onDateChange({ ...dateRange, from: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="gaps-to">{strings.filters.to}</Label>
        <Input id="gaps-to" type="date" value={dateRange.to}
          onChange={(e) => onDateChange({ ...dateRange, to: e.target.value })} />
      </div>
      <div className="flex items-end gap-2">
        {PRESET_ORDER.map((p) => (
          <Button key={p} type="button" variant="outline" size="sm" onClick={() => onApplyPreset(p)}>
            {strings.datePresets[p]}
          </Button>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <Label>{strings.gaps.product}</Label>
        <Select value={product} onValueChange={onProductChange}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={PRODUCT_ALL}>{strings.gaps.allProducts}</SelectItem>
            <SelectItem value={PRODUCT_NONE}>{strings.gaps.noProduct}</SelectItem>
            {productOptions.map((c) => (
              <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label>{strings.gaps.origCountry}</Label>
        <Select
          value={originCountry === "" ? ALL_COUNTRY : originCountry}
          onValueChange={(v) => onOriginCountryChange(v === ALL_COUNTRY ? "" : v)}
        >
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_COUNTRY}>{strings.filters.all}</SelectItem>
            {countryOptions.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label>{strings.gaps.destCountry}</Label>
        <Select
          value={destCountry === "" ? ALL_COUNTRY : destCountry}
          onValueChange={(v) => onDestCountryChange(v === ALL_COUNTRY ? "" : v)}
        >
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_COUNTRY}>{strings.filters.all}</SelectItem>
            {countryOptions.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label>{strings.gaps.granularity}</Label>
        <div className="flex gap-1">
          <Button type="button" size="sm"
            variant={granularity === "centre" ? "default" : "outline"}
            onClick={() => onGranularityChange("centre")}>
            {strings.gaps.granularityCentre}
          </Button>
          <Button type="button" size="sm"
            variant={granularity === "country" ? "default" : "outline"}
            onClick={() => onGranularityChange("country")}>
            {strings.gaps.granularityCountry}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label>{strings.gaps.unit}</Label>
        <div className="flex gap-1">
          <Button type="button" size="sm"
            variant={unit === "days" ? "default" : "outline"}
            onClick={() => onUnitChange("days")}>
            {strings.gaps.unitDays}
          </Button>
          <Button type="button" size="sm"
            variant={unit === "hours" ? "default" : "outline"}
            onClick={() => onUnitChange("hours")}>
            {strings.gaps.unitHours}
          </Button>
        </div>
      </div>
    </div>
  );
}
