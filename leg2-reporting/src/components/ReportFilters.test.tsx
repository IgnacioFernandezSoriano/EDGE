import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReportFilters } from "@/components/ReportFilters";
import type { ReportFilterState } from "@/lib/filter";
import { strings } from "@/i18n/strings";

const base: ReportFilterState = {
  originCountry: null, destCountry: null, s9Query: "", rteQuery: "",
};

const baseDateRange = { from: "2026-04-06", to: "2026-07-04" };

describe("ReportFilters", () => {
  it("renders the S9 search and reports typing", () => {
    const setFilter = vi.fn();
    render(
      <ReportFilters
        filter={base}
        setFilter={setFilter}
        originOptions={["IN", "JP"]}
        destOptions={["JP"]}
        timeMode="utc"
        onTimeModeChange={() => {}}
        dateRange={baseDateRange}
        onDateChange={() => {}}
        onApplyPreset={() => {}}
      />
    );
    fireEvent.change(screen.getByPlaceholderText("Search S9"), { target: { value: "abc" } });
    expect(setFilter).toHaveBeenCalled();
  });

  it("clicking a preset button fires onApplyPreset", () => {
    const onApplyPreset = vi.fn();
    render(
      <ReportFilters
        filter={base}
        setFilter={() => {}}
        originOptions={[]}
        destOptions={[]}
        timeMode="utc"
        onTimeModeChange={() => {}}
        dateRange={baseDateRange}
        onDateChange={() => {}}
        onApplyPreset={onApplyPreset}
      />
    );
    fireEvent.click(screen.getByText(strings.datePresets.last90Days));
    expect(onApplyPreset).toHaveBeenCalledWith("last90Days");
  });
});
