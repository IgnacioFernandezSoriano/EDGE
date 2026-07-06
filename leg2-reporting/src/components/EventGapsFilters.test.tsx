import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EventGapsFilters } from "@/components/EventGapsFilters";

function setup(over: Partial<React.ComponentProps<typeof EventGapsFilters>> = {}) {
  const props = {
    dateRange: { from: "2026-01-01", to: "2026-03-31" },
    onDateChange: vi.fn(),
    onApplyPreset: vi.fn(),
    product: "all",
    onProductChange: vi.fn(),
    productOptions: [{ code: "A", name: "Aéreo / Prioritario" }],
    originCountry: "",
    destCountry: "",
    onOriginCountryChange: vi.fn(),
    onDestCountryChange: vi.fn(),
    countryOptions: ["IN", "JP"],
    granularity: "centre" as const,
    onGranularityChange: vi.fn(),
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
    expect(screen.getByText("Aéreo / Prioritario")).toBeInTheDocument();
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
});
