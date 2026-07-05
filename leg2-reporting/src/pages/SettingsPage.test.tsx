import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPage from "@/pages/SettingsPage";
import { strings } from "@/i18n/strings";

const statusRow = (over = {}) => ({
  reprocess_run_id: "run-1", status: "success", reads_selected: 36000,
  movements_upserted: 7, incidents_created: 0, error_message: null, reason: "r", ...over,
});

const deps = (over = {}) => ({
  // "started" is not terminal, so the outcome must come from the status poll.
  triggerReprocessFn: vi.fn(async () => ({ ok: true, status: "started", movements_upserted: 0 })),
  fetchStatusFn: vi.fn(async () => statusRow()),
  fetchReadersFn: vi.fn(async () => [{ reader_id: "LPI-1", facility_name: "Sao Paulo", site_impc_code: null }]),
  fetchSitesFn: vi.fn(async () => [{ centre_code: "centre-abc", site_name: "TECA Guarulhos", country_code: "BR" }]),
  makeToken: () => "tok",
  pollMs: 0,
  ...over,
});

describe("SettingsPage", () => {
  it("global: fires reprocess with a token and shows the polled result", async () => {
    const d = deps();
    render(<SettingsPage deps={d} />);
    await userEvent.click(screen.getByText(strings.settings.scopeGlobal));
    await userEvent.click(screen.getByRole("button", { name: strings.settings.recalc }));
    await userEvent.click(screen.getByRole("button", { name: strings.settings.confirm }));
    await waitFor(() => expect(d.triggerReprocessFn).toHaveBeenCalledWith("global", null, "tok"));
    expect(d.fetchStatusFn).toHaveBeenCalledWith("settings_reprocess_global:tok");
    expect(await screen.findByText(/movements upserted: 7/i)).toBeInTheDocument();
  });

  it("site: recalc button disabled until a site is chosen", async () => {
    const d = deps();
    render(<SettingsPage deps={d} />);
    await userEvent.click(screen.getByText(strings.settings.scopeSite));
    expect(screen.getByRole("button", { name: strings.settings.recalc })).toBeDisabled();
  });

  it("surfaces a failed run from the status poll", async () => {
    const d = deps({ fetchStatusFn: vi.fn(async () => statusRow({ status: "failed", error_message: "boom", movements_upserted: 0 })) });
    render(<SettingsPage deps={d} />);
    await userEvent.click(screen.getByText(strings.settings.scopeGlobal));
    await userEvent.click(screen.getByRole("button", { name: strings.settings.recalc }));
    await userEvent.click(screen.getByRole("button", { name: strings.settings.confirm }));
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });
});
