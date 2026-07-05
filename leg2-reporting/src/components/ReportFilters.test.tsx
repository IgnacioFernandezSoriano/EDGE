import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReportFilters } from "@/components/ReportFilters";
import type { ReportFilterState } from "@/lib/filter";
import { strings } from "@/i18n/strings";

const base: ReportFilterState = {
  originCountry: null, destCountry: null, s9Query: "", rteQuery: "", onlyNoEventCode: false,
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
        hasIncidents
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
        hasIncidents
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

  it("toggling 'Only No Event Code' updates the filter", () => {
    const setFilter = vi.fn();
    render(
      <ReportFilters
        filter={base}
        setFilter={setFilter}
        originOptions={[]}
        destOptions={[]}
        hasIncidents
        timeMode="utc"
        onTimeModeChange={() => {}}
        dateRange={baseDateRange}
        onDateChange={() => {}}
        onApplyPreset={() => {}}
      />
    );
    fireEvent.click(screen.getByLabelText(strings.filters.onlyNoEventCode));
    expect(setFilter).toHaveBeenCalled();
  });

  it("disables the 'Only No Event Code' toggle when there are no incidents", () => {
    render(
      <ReportFilters
        filter={base}
        setFilter={() => {}}
        originOptions={[]}
        destOptions={[]}
        hasIncidents={false}
        timeMode="utc"
        onTimeModeChange={() => {}}
        dateRange={baseDateRange}
        onDateChange={() => {}}
        onApplyPreset={() => {}}
      />
    );
    expect(screen.getByLabelText(strings.filters.onlyNoEventCode)).toBeDisabled();
  });
});
