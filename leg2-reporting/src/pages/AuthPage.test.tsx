import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Stub the three forms so this test only covers mode switching.
vi.mock("@/components/auth/SignInForm", () => ({ SignInForm: () => <div>SIGNIN_FORM</div> }));
vi.mock("@/components/auth/SignUpForm", () => ({ SignUpForm: () => <div>SIGNUP_FORM</div> }));
vi.mock("@/components/auth/ForgotPasswordForm", () => ({
  ForgotPasswordForm: () => <div>FORGOT_FORM</div>,
}));

import AuthPage from "@/pages/AuthPage";

describe("AuthPage", () => {
  it("shows sign-in by default and switches modes via links", async () => {
    const user = userEvent.setup();
    render(<AuthPage />);
    expect(screen.getByText("SIGNIN_FORM")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("SIGNUP_FORM")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(screen.getByText("SIGNIN_FORM")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(screen.getByText("FORGOT_FORM")).toBeInTheDocument();
  });
});
