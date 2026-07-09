import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { EventGapsFilters } from "@/components/EventGapsFilters";
import { presetRange } from "@/lib/datePresets";
import { strings } from "@/i18n/strings";

function setup(over: Partial<React.ComponentProps<typeof EventGapsFilters>> = {}) {
  const props = {
    dateRange: { from: "2026-01-01", to: "2026-03-31" },
    onDateChange: vi.fn(),
    onApplyPreset: vi.fn(),
    product: "all",
    onProductChange: vi.fn(),
    productOptions: [{ code: "A", name: "Airmail / Priority" }],
    hasNoProduct: false,
    originCountry: "",
    destCountry: "",
    onOriginCountryChange: vi.fn(),
    onDestCountryChange: vi.fn(),
    countryOptions: ["IN", "JP"],
    granularity: "centre" as const,
    onGranularityChange: vi.fn(),
    unit: "days" as const,
    onUnitChange: vi.fn(),
    onClear: vi.fn(),
    canClear: false,
    ...over,
  };
  render(<EventGapsFilters {...props} />);
  return props;
}

describe("EventGapsFilters", () => {
  it("renders the date inputs with the current range", () => {
    setup();
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-01-01");
    expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe("2026-03-31");
  });
  it("toggles granularity to country", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Country" }));
    expect(props.onGranularityChange).toHaveBeenCalledWith("country");
  });
  it("emits a date change when From is edited", () => {
    const props = setup();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-02-01" } });
    expect(props.onDateChange).toHaveBeenCalledWith({ from: "2026-02-01", to: "2026-03-31" });
  });
  it("shows the product option's name, not its code", () => {
    setup();
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    expect(screen.getByText("Airmail / Priority")).toBeInTheDocument();
  });
  it("hides (no product) when hasNoProduct is false", () => {
    setup({ hasNoProduct: false });
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    expect(screen.queryByText("(no product)")).not.toBeInTheDocument();
    expect(within(screen.getByRole("listbox")).getByText("All products")).toBeInTheDocument();
  });
  it("shows (no product) when hasNoProduct is true", () => {
    setup({ hasNoProduct: true });
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    expect(screen.getByText("(no product)")).toBeInTheDocument();
  });
  it("renders origin and destination country selects", () => {
    setup();
    expect(screen.getByText("Orig country")).toBeInTheDocument();
    expect(screen.getByText("Dest country")).toBeInTheDocument();
  });
  it("emits the country code when an origin country is selected", () => {
    const props = setup();
    const [, originTrigger] = screen.getAllByRole("combobox");
    fireEvent.click(originTrigger);
    fireEvent.click(screen.getAllByText("IN")[0]);
    expect(props.onOriginCountryChange).toHaveBeenCalledWith("IN");
  });
  it("calls onUnitChange('hours') when Hours is clicked", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Hours" }));
    expect(props.onUnitChange).toHaveBeenCalledWith("hours");
  });
  it("highlights the preset matching the current range and no other", () => {
    setup({ dateRange: presetRange("lastWeek") });
    expect(screen.getByRole("button", { name: strings.datePresets.lastWeek }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: strings.datePresets.today }))
      .toHaveAttribute("aria-pressed", "false");
  });
  it("highlights no preset when the range was hand-edited", () => {
    setup({ dateRange: { from: "2026-01-01", to: "2026-03-15" } });
    for (const label of Object.values(strings.datePresets)) {
      expect(screen.getByRole("button", { name: label }))
        .toHaveAttribute("aria-pressed", "false");
    }
  });
  it("disables Clear filters when canClear is false", () => {
    setup({ canClear: false });
    expect(screen.getByRole("button", { name: strings.filters.clearFilters })).toBeDisabled();
  });
  it("clicking Clear filters fires onClear when enabled", () => {
    const props = setup({ canClear: true });
    fireEvent.click(screen.getByRole("button", { name: strings.filters.clearFilters }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });
});
