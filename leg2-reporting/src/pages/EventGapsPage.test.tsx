import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { matrix, comparisons, detail } = vi.hoisted(() => ({
  matrix: [{ origin: "IN", destination: "JP", comparison_key: "ho_rescon", mean_days: 3.2, n: 4 }],
  comparisons: [{ comparison_key: "ho_rescon", priority: 1, label: "HO vs RESCON" }],
  detail: [{
    s9code: "S9A", comparison_key: "ho_rescon", origin_office: "INBOMB", dest_office: "JPTYOA",
    origin_country: "IN", dest_country: "JP", product: "A",
    rfid_utc: "2026-02-01T10:00:00+00:00", edi_utc: "2026-02-04T12:00:00+00:00",
    gap_days: 3.08, colocation_valid: true, excluded: false,
  }],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  fetchEventComparisons: vi.fn().mockResolvedValue(comparisons),
  fetchEventPairMatrix: vi.fn().mockResolvedValue(matrix),
  fetchEventPairDetail: vi.fn().mockResolvedValue(detail),
  setEventPairExclusion: vi.fn().mockResolvedValue(undefined),
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
});
