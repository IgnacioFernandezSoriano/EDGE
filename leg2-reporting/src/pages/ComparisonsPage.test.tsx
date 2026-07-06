import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { comparisons, vocab } = vi.hoisted(() => ({
  comparisons: [
    { comparison_key: "ho_rescon", name: "Handover → RESCON", priority: 1,
      a_source: "RFID", a_code: "__HO__", b_source: "EDI", b_code: "RESCON" },
  ],
  vocab: [
    { source: "RFID", code: "__HO__", n: 8000 },
    { source: "RFID", code: "2320", n: 1300 },
    { source: "EDI", code: "RESCON", n: 8600 },
    { source: "EDI", code: "RESDES", n: 10000 },
  ],
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  fetchEventComparisons: vi.fn().mockResolvedValue(comparisons),
  fetchComparisonEvents: vi.fn().mockResolvedValue(vocab),
  createComparison: vi.fn().mockResolvedValue(undefined),
  updateComparison: vi.fn().mockResolvedValue(undefined),
  deleteComparison: vi.fn().mockResolvedValue(undefined),
}));

import ComparisonsPage from "@/pages/ComparisonsPage";
import { createComparison, deleteComparison } from "@/lib/supabase";

describe("ComparisonsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("lists existing comparisons", async () => {
    render(<ComparisonsPage />);
    await waitFor(() => expect(screen.getByText("Handover → RESCON")).toBeInTheDocument());
  });

  it("creates a comparison from the add form", async () => {
    render(<ComparisonsPage />);
    await waitFor(() => expect(screen.getByText("Handover → RESCON")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Add comparison" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My cmp" } });
    fireEvent.change(screen.getByLabelText("Event A"), { target: { value: "RFID|2320" } });
    fireEvent.change(screen.getByLabelText("Event B"), { target: { value: "EDI|RESDES" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(createComparison).toHaveBeenCalledWith(
      expect.objectContaining({ name: "My cmp", a_source: "RFID", a_code: "2320", b_source: "EDI", b_code: "RESDES" }),
      expect.anything()
    ));
  });

  it("disables Save when Event A and Event B are the same", async () => {
    render(<ComparisonsPage />);
    await waitFor(() => expect(screen.getByText("Handover → RESCON")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Add comparison" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My cmp" } });
    fireEvent.change(screen.getByLabelText("Event A"), { target: { value: "RFID|2320" } });
    fireEvent.change(screen.getByLabelText("Event B"), { target: { value: "RFID|2320" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("deletes a comparison", async () => {
    render(<ComparisonsPage />);
    await waitFor(() => expect(screen.getByText("Handover → RESCON")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Delete/i }));
    await waitFor(() => expect(deleteComparison).toHaveBeenCalledWith("ho_rescon", expect.anything()));
  });
});
