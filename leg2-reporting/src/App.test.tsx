import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { strings } from "@/i18n/strings";

// Force an authenticated session so the Gate renders the app, not the login page.
vi.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({ session: { user: { email: "t@example.com" } }, user: { email: "t@example.com" }, isLoading: false, isRecovery: false, signOut: vi.fn() }),
}));

// Keep the report page cheap: stub the data hook.
vi.mock("@/hooks/useRfidEventsReport", () => ({
  useRfidEventsReport: () => ({
    loading: false, error: null,
    report: { rows: [], columns: [], hasNoEventCodeOutbound: false, hasNoEventCodeInbound: false },
    hasIncidents: false, readerMap: new Map(), filter: { onlyNoEventCode: false },
    setFilter: vi.fn(), originOptions: [], destOptions: [],
    dateRange: { from: "2026-01-01", to: "2026-12-31" }, setDateRange: vi.fn(),
    applyPreset: vi.fn(), reload: vi.fn(),
  }),
}));

vi.mock("@/pages/SettingsPage", () => ({ default: () => <div>SETTINGS_PAGE</div> }));

import App from "@/App";

beforeEach(() => { window.location.hash = ""; });

describe("App routing", () => {
  it("shows the report by default and the ATAT search when navigating", async () => {
    render(<App />);
    expect(screen.getByRole("button", { name: strings.atat.navReport })).toBeInTheDocument();
    window.location.hash = "#/receptacle";
    fireEvent(window, new HashChangeEvent("hashchange"));
    await waitFor(() =>
      expect(screen.getByLabelText(/Receptacle .* code/i)).toBeInTheDocument()
    );
  });

  it("shows the Event gaps nav button", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: strings.gaps.nav })).toBeInTheDocument();
  });

  it("does not show a top-level Comparisons nav button (now inside Config)", () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: strings.comparisons.nav })).not.toBeInTheDocument();
  });
});

describe("App settings route", () => {
  it("shows the Settings nav item", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: strings.settings.nav })).toBeInTheDocument();
  });
  it("renders SettingsPage at #/settings", () => {
    window.location.hash = "#/settings";
    render(<App />);
    expect(screen.getByText("SETTINGS_PAGE")).toBeInTheDocument();
  });
});
