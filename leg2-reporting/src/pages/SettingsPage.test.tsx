import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPage from "@/pages/SettingsPage";
import { strings } from "@/i18n/strings";

const deps = (over = {}) => ({
  triggerReprocessFn: vi.fn(async () => ({ ok: true, status: "success", movements_upserted: 7, reprocess_run_id: "run-1" })),
  fetchReadersFn: vi.fn(async () => [{ lpi: "LPI-1", facility_name: "Sao Paulo", handover_point: false } as never]),
  fetchSitesFn: vi.fn(async () => [{ site_impc_code: "BRSAOA", site_name: "Sao Paulo", country_name: "Brazil" }]),
  ...over,
});

describe("SettingsPage", () => {
  it("global: recalc opens confirm, confirm calls triggerReprocess and shows result", async () => {
    const d = deps();
    render(<SettingsPage deps={d} />);
    await userEvent.click(screen.getByText(strings.settings.scopeGlobal));
    await userEvent.click(screen.getByRole("button", { name: strings.settings.recalc }));
    // confirm dialog
    await userEvent.click(screen.getByRole("button", { name: strings.settings.confirm }));
    await waitFor(() => expect(d.triggerReprocessFn).toHaveBeenCalledWith("global", null));
    expect(await screen.findByText(/movements upserted: 7/i)).toBeInTheDocument();
  });

  it("site: recalc button disabled until a site is chosen", async () => {
    const d = deps();
    render(<SettingsPage deps={d} />);
    await userEvent.click(screen.getByText(strings.settings.scopeSite));
    expect(screen.getByRole("button", { name: strings.settings.recalc })).toBeDisabled();
  });

  it("surfaces an error result", async () => {
    const d = deps({ triggerReprocessFn: vi.fn(async () => ({ ok: false, status: "reprocess_failed", movements_upserted: 0, error: "boom" })) });
    render(<SettingsPage deps={d} />);
    await userEvent.click(screen.getByText(strings.settings.scopeGlobal));
    await userEvent.click(screen.getByRole("button", { name: strings.settings.recalc }));
    await userEvent.click(screen.getByRole("button", { name: strings.settings.confirm }));
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });
});
