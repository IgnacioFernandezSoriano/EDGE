import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const { matrix, comparisons, detail, products } = vi.hoisted(() => ({
  matrix: [{ origin: "IN", destination: "JP", comparison_key: "ho_rescon", mean_days: 3.2, n: 4 }],
  comparisons: [{ comparison_key: "ho_rescon", name: "Handover → RESCON", priority: 1,
    a_source: "RFID", a_code: "__HO__", b_source: "EDI", b_code: "RESCON" }],
  detail: [{
    s9code: "S9A", comparison_key: "ho_rescon", origin_office: "INBOMB", dest_office: "JPTYOA",
    origin_country: "IN", dest_country: "JP", product: "A",
    origin_gate: "G1", origin_site: "Site A", dest_gate: null, dest_site: null,
    a_utc: "2026-02-01T10:00:00+00:00", b_utc: "2026-02-04T12:00:00+00:00",
    gap_days: 3.08, excluded: false,
  }],
  products: [{ code: "A", name: "Airmail / Priority" }, { code: null, name: null }],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  fetchEventComparisons: vi.fn().mockResolvedValue(comparisons),
  fetchEventPairMatrix: vi.fn().mockResolvedValue(matrix),
  fetchEventPairDetail: vi.fn().mockResolvedValue(detail),
  setEventPairExclusion: vi.fn().mockResolvedValue(undefined),
  fetchEventPairProducts: vi.fn().mockResolvedValue(products),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { email: "u@example.com" } }),
}));
import EventGapsPage from "@/pages/EventGapsPage";
import { setEventPairExclusion } from "@/lib/supabase";

describe("EventGapsPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the matrix and opens the detail dialog on cell click", async () => {
    render(<EventGapsPage />);
    await waitFor(() => expect(screen.getByText("3.2")).toBeInTheDocument());
    fireEvent.click(screen.getByText("3.2"));
    await waitFor(() => expect(screen.getByText("S9A")).toBeInTheDocument());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/HO → RESCON/)).toBeInTheDocument();
  });

  it("writes an exclusion when a detail checkbox is toggled", async () => {
    render(<EventGapsPage />);
    await waitFor(() => expect(screen.getByText("3.2")).toBeInTheDocument());
    fireEvent.click(screen.getByText("3.2"));
    await waitFor(() => expect(screen.getByText("S9A")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() =>
      expect(setEventPairExclusion).toHaveBeenCalledWith(
        expect.objectContaining({ s9code: "S9A", comparisonKey: "ho_rescon", excluded: true, excludedBy: "u@example.com" }),
        expect.anything()
      )
    );
  });

  it("shows the mail category name in the product filter", async () => {
    render(<EventGapsPage />);
    await waitFor(() => expect(screen.getByText("3.2")).toBeInTheDocument());
    const triggers = screen.getAllByRole("combobox");
    fireEvent.click(triggers[0]);
    await waitFor(() => expect(screen.getByText("Airmail / Priority")).toBeInTheDocument());
  });

  it("opens the receptacle detail in a new tab when an S9 is clicked", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    render(<EventGapsPage />);
    await waitFor(() => expect(screen.getByText("3.2")).toBeInTheDocument());
    fireEvent.click(screen.getByText("3.2"));
    await waitFor(() => expect(screen.getByText("S9A")).toBeInTheDocument());
    fireEvent.click(screen.getByText("S9A"));
    expect(openSpy).toHaveBeenCalledWith("/#/receptacle/S9A", "_blank", "noopener");
    openSpy.mockRestore();
  });

  it("switches matrix values to hours via the unit toggle", async () => {
    render(<EventGapsPage />);
    await waitFor(() => expect(screen.getByText("3.2")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Hours" }));
    await waitFor(() => expect(screen.getByText("76.8")).toBeInTheDocument());
  });
});
