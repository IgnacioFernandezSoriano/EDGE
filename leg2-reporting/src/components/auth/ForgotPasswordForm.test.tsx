import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const requestPasswordReset = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ requestPasswordReset }) }));

import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

describe("ForgotPasswordForm", () => {
  beforeEach(() => requestPasswordReset.mockReset());

  it("blocks submit on invalid email", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Email"), "nope");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
  });

  it("shows a neutral confirmation after requesting a reset", async () => {
    const user = userEvent.setup();
    requestPasswordReset.mockResolvedValue({ error: null });
    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(requestPasswordReset).toHaveBeenCalledWith("a@b.com");
    expect(await screen.findByText("Check your email")).toBeInTheDocument();
  });
});
