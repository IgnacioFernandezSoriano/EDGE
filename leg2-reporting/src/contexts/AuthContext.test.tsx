import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { getSession, onAuthStateChange } = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession, onAuthStateChange } },
}));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";

function Probe() {
  const { isLoading, session } = useAuth();
  return <div>{isLoading ? "loading" : session ? "in" : "out"}</div>;
}

describe("AuthContext", () => {
  beforeEach(() => {
    getSession.mockReset();
    onAuthStateChange.mockReset();
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  });

  it("resolves to signed-out when no session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByText("out")).toBeInTheDocument());
  });
});
