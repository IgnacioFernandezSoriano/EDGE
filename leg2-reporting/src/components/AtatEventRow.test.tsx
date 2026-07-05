import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AtatEventRow } from "@/components/AtatEventRow";
import type { AtatEvent } from "@/lib/atat";

const base: AtatEvent = {
  source: "EDI", code: "RESDES", label: "Dispatch arrival at IOE",
  timestamp: new Date(Date.UTC(2026, 4, 1, 15, 28)), displayTime: "Fri,01-05-2026 15:28",
  rawDate: "Fri,01-05-2026 15:28", location: "KRSELB", direction: "inbound",
  fields: [
    { label: "Location", value: "KRSELB" },
    { label: "Transport", value: "SQ0612" },
  ],
};

describe("AtatEventRow", () => {
  it("renders code, label, time, location and all inline fields", () => {
    render(<AtatEventRow event={base} />);
    expect(screen.getByText("RESDES")).toBeInTheDocument();
    expect(screen.getByText("Dispatch arrival at IOE")).toBeInTheDocument();
    expect(screen.getByText("Fri,01-05-2026 15:28")).toBeInTheDocument();
    expect(screen.getByText("SQ0612")).toBeInTheDocument();
    expect(screen.getByText("KRSELB", { selector: "[data-role='location']" })).toBeInTheDocument();
  });

  it("tags the source (RFID vs EDI)", () => {
    render(<AtatEventRow event={{ ...base, source: "RFID" }} />);
    expect(screen.getByText("RFID")).toBeInTheDocument();
  });
});
