import { strings } from "@/i18n/strings";

const s = strings.auth;

export function validateEmail(email: string): string | null {
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return ok ? null : s.errors.invalidEmail;
}

export function validatePassword(password: string): string | null {
  return password.length >= 8 ? null : s.errors.passwordTooShort;
}

export function friendlyAuthError(
  error: { message: string } | null | undefined
): string | null {
  if (!error) return null;
  const m = error.message.toLowerCase();
  if (m.includes("invalid login credentials")) return s.errors.invalidCredentials;
  if (m.includes("email not confirmed")) return s.errors.emailNotConfirmed;
  if (m.includes("user already registered")) return s.errors.userExists;
  if (m.includes("signups not allowed") || m.includes("signup is disabled"))
    return s.errors.signupDisabled;
  return error.message;
}
