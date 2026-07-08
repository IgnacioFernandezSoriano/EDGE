import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signIn = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ signIn }) }));

import { SignInForm } from "@/components/auth/SignInForm";

describe("SignInForm", () => {
  beforeEach(() => signIn.mockReset());

  it("blocks submit and shows an error on invalid email", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);
    await user.type(screen.getByLabelText("Email"), "nope");
    await user.type(screen.getByLabelText("Password"), "12345678");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(signIn).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
  });

  it("calls signIn with credentials and surfaces the returned error", async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue({ error: "Incorrect email or password." });
    render(<SignInForm />);
    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "12345678");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(signIn).toHaveBeenCalledWith("a@b.com", "12345678");
    expect(await screen.findByText("Incorrect email or password.")).toBeInTheDocument();
  });
});
