import { describe, it, expect } from "vitest";
import { validateEmail, validatePassword, friendlyAuthError } from "@/lib/auth";
import { strings } from "@/i18n/strings";

const e = strings.auth.errors;

describe("validateEmail", () => {
  it("accepts a well-formed email", () => {
    expect(validateEmail("a@b.com")).toBeNull();
  });
  it("rejects a malformed email", () => {
    expect(validateEmail("nope")).toBe(e.invalidEmail);
  });
  it("trims surrounding whitespace before validating", () => {
    expect(validateEmail("  a@b.com  ")).toBeNull();
  });
});

describe("validatePassword", () => {
  it("accepts 8+ characters", () => {
    expect(validatePassword("12345678")).toBeNull();
  });
  it("rejects shorter than 8", () => {
    expect(validatePassword("1234567")).toBe(e.passwordTooShort);
  });
});

describe("friendlyAuthError", () => {
  it("returns null for no error", () => {
    expect(friendlyAuthError(null)).toBeNull();
  });
  it("maps invalid credentials", () => {
    expect(friendlyAuthError({ message: "Invalid login credentials" })).toBe(e.invalidCredentials);
  });
  it("maps already-registered", () => {
    expect(friendlyAuthError({ message: "User already registered" })).toBe(e.userExists);
  });
  it("maps disabled signups", () => {
    expect(friendlyAuthError({ message: "Signups not allowed for this instance" })).toBe(e.signupDisabled);
  });
  it("passes through unknown messages", () => {
    expect(friendlyAuthError({ message: "Weird backend error" })).toBe("Weird backend error");
  });
});
