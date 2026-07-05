import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AtatPage from "@/pages/AtatPage";

beforeEach(() => {
  window.location.hash = "";
});

describe("AtatPage search", () => {
  it("navigates to the receptacle hash on submit", () => {
    render(<AtatPage s9={null} />);
    const input = screen.getByLabelText(/Receptacle .* code/i);
    fireEvent.change(input, { target: { value: "  INBOMAJPKWSAAUY60597001100039 " } });
    fireEvent.click(screen.getByRole("button", { name: /open/i }));
    expect(window.location.hash).toBe("#/receptacle/INBOMAJPKWSAAUY60597001100039");
  });
});

describe("AtatPage load", () => {
  const deps = {
    fetchMovements: vi.fn().mockResolvedValue([]),
    fetchEvents: vi.fn().mockResolvedValue([
      { message: "RESDES", event: "Dispatch arrival at IOE", date: "Fri,01-05-2026 15:28",
        location: "KRSELB", transport: "SQ0612", transport_date: null, reference: null },
    ]),
    fetchDetails: vi.fn().mockResolvedValue({
      s9code: "ABC", origin_office: "INBOMA", destination_office: "JPKWSA",
      mail_category: "U", mail_subclass: "A", rec_no: "1", gross_weight: "2", items: "3",
    }),
    getToken: vi.fn().mockResolvedValue("tok"),
  };

  it("renders the header and a timeline row", async () => {
    render(<AtatPage s9="ABC" deps={deps} />);
    await waitFor(() => expect(screen.getByText("RESDES")).toBeInTheDocument());
    expect(screen.getByText("ABC")).toBeInTheDocument();
    expect(screen.getByText("Dispatch arrival at IOE")).toBeInTheDocument();
  });

  it("shows an empty state when there are no events", async () => {
    render(<AtatPage s9="ZZZ" deps={{ ...deps,
      fetchEvents: vi.fn().mockResolvedValue([]),
      fetchDetails: vi.fn().mockResolvedValue(null),
    }} />);
    await waitFor(() => expect(screen.getByText(/No events found/i)).toBeInTheDocument());
  });
});
