import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { matrix, comparisons, detail, mailCategories } = vi.hoisted(() => ({
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
  mailCategories: [{ code: "A", name: "Aéreo / Prioritario" }],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  fetchEventComparisons: vi.fn().mockResolvedValue(comparisons),
  fetchEventPairMatrix: vi.fn().mockResolvedValue(matrix),
  fetchEventPairDetail: vi.fn().mockResolvedValue(detail),
  setEventPairExclusion: vi.fn().mockResolvedValue(undefined),
  fetchMailCategories: vi.fn().mockResolvedValue(mailCategories),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { email: "u@example.com" } }),
}));
vi.mock("@/components/AtatDialog", () => ({
  AtatDialog: ({ s9 }: { s9: string | null }) => (s9 ? <div>atat:{s9}</div> : null),
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
    await waitFor(() => expect(screen.getByText("Aéreo / Prioritario")).toBeInTheDocument());
  });

  it("opens the ATAT dialog when an S9 in the detail dialog is clicked", async () => {
    render(<EventGapsPage />);
    await waitFor(() => expect(screen.getByText("3.2")).toBeInTheDocument());
    fireEvent.click(screen.getByText("3.2"));
    await waitFor(() => expect(screen.getByText("S9A")).toBeInTheDocument());
    fireEvent.click(screen.getByText("S9A"));
    await waitFor(() => expect(screen.getByText("atat:S9A")).toBeInTheDocument());
  });
});
