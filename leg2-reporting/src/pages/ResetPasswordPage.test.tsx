import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const updatePassword = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ updatePassword }) }));

import ResetPasswordPage from "@/pages/ResetPasswordPage";

describe("ResetPasswordPage", () => {
  beforeEach(() => updatePassword.mockReset());

  it("blocks submit when the two passwords differ", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await user.type(screen.getByLabelText("New password"), "newpass12");
    await user.type(screen.getByLabelText("Confirm password"), "different1");
    await user.click(screen.getByRole("button", { name: "Update password" }));
    expect(updatePassword).not.toHaveBeenCalled();
    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
  });

  it("calls updatePassword when the passwords match", async () => {
    const user = userEvent.setup();
    updatePassword.mockResolvedValue({ error: null });
    render(<ResetPasswordPage />);
    await user.type(screen.getByLabelText("New password"), "newpass12");
    await user.type(screen.getByLabelText("Confirm password"), "newpass12");
    await user.click(screen.getByRole("button", { name: "Update password" }));
    expect(updatePassword).toHaveBeenCalledWith("newpass12");
  });
});
