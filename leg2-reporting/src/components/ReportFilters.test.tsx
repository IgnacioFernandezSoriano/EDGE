import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReportFilters } from "@/components/ReportFilters";
import type { ReportFilterState } from "@/lib/filter";

const base: ReportFilterState = {
  tab: "outbound", originCountry: null, destCountry: null, s9Query: "", rteQuery: "",
};

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
      />
    );
    fireEvent.change(screen.getByPlaceholderText("Search S9"), { target: { value: "abc" } });
    expect(setFilter).toHaveBeenCalled();
  });
});
