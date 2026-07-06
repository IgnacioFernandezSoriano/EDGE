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
    productOptions: ["A", "B"],
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
});
