import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signUp = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ signUp }) }));

import { SignUpForm } from "@/components/auth/SignUpForm";

async function fill(user: ReturnType<typeof userEvent.setup>, pw: string, confirm: string) {
  await user.type(screen.getByLabelText("Email"), "a@b.com");
  await user.type(screen.getByLabelText("Password"), pw);
  await user.type(screen.getByLabelText("Confirm password"), confirm);
}

describe("SignUpForm", () => {
  beforeEach(() => signUp.mockReset());

  it("blocks submit when passwords don't match", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);
    await fill(user, "12345678", "different");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(signUp).not.toHaveBeenCalled();
    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
  });

  it("shows the pending-approval panel after a successful sign-up", async () => {
    const user = userEvent.setup();
    signUp.mockResolvedValue({ error: null });
    render(<SignUpForm />);
    await fill(user, "12345678", "12345678");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(signUp).toHaveBeenCalledWith("a@b.com", "12345678");
    expect(await screen.findByText("Account requested")).toBeInTheDocument();
  });
});
