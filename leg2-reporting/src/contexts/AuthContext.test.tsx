import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

const {
  getSession, onAuthStateChange, signInWithPassword,
  signUp, resetPasswordForEmail, updateUser, signOut,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession, onAuthStateChange, signInWithPassword,
      signUp, resetPasswordForEmail, updateUser, signOut,
    },
  },
}));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";

let ctx: ReturnType<typeof useAuth>;
function Probe() {
  ctx = useAuth();
  return <div>{ctx.isLoading ? "loading" : ctx.session ? "in" : "out"}</div>;
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
}

describe("AuthContext", () => {
  let authCb: (event: string, session: unknown) => void;
  beforeEach(() => {
    getSession.mockReset().mockResolvedValue({ data: { session: null } });
    onAuthStateChange.mockReset().mockImplementation((cb) => {
      authCb = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    signUp.mockReset();
    resetPasswordForEmail.mockReset();
    updateUser.mockReset();
    signOut.mockReset().mockResolvedValue({ error: null });
  });

  it("resolves to signed-out when no session", async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByText("out")).toBeInTheDocument());
  });

  it("sets isRecovery on PASSWORD_RECOVERY", async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByText("out")).toBeInTheDocument());
    act(() => authCb("PASSWORD_RECOVERY", { user: { id: "u1" } }));
    await waitFor(() => expect(ctx.isRecovery).toBe(true));
  });

  it("signUp maps errors via friendlyAuthError", async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByText("out")).toBeInTheDocument());
    signUp.mockResolvedValue({ error: { message: "User already registered" } });
    const res = await ctx.signUp("a@b.com", "12345678");
    expect(signUp).toHaveBeenCalledWith({ email: "a@b.com", password: "12345678" });
    expect(res.error).toBe("An account with this email already exists.");
  });

  it("requestPasswordReset calls resetPasswordForEmail with redirectTo", async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByText("out")).toBeInTheDocument());
    resetPasswordForEmail.mockResolvedValue({ error: null });
    const res = await ctx.requestPasswordReset("a@b.com");
    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      "a@b.com",
      { redirectTo: window.location.origin }
    );
    expect(res.error).toBeNull();
  });

  it("updatePassword clears isRecovery on success", async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByText("out")).toBeInTheDocument());
    act(() => authCb("PASSWORD_RECOVERY", { user: { id: "u1" } }));
    await waitFor(() => expect(ctx.isRecovery).toBe(true));
    updateUser.mockResolvedValue({ error: null });
    await act(async () => {
      await ctx.updatePassword("newpass12");
    });
    expect(updateUser).toHaveBeenCalledWith({ password: "newpass12" });
    expect(ctx.isRecovery).toBe(false);
  });
});
