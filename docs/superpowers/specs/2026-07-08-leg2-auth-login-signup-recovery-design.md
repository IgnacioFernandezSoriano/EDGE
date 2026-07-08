# Leg2 Reporting — Modern auth: login, signup request, password recovery

**Date:** 2026-07-08
**App:** `leg2-reporting/` (React 19 + Vite + Tailwind v4 + shadcn-style UI + lucide-react + supabase-js)
**Scope of this delivery:** frontend only. No Leg2 database changes.

## Goal

Replace the minimal `LoginPage` with a modern, single-card auth screen that supports:

1. **Sign in** with a show/hide password toggle.
2. **Password recovery** — full, usable flow: request a reset email **and** the landing screen that sets the new password.
3. **Sign up ("solicitar alta")** — self-registration via `supabase.auth.signUp`; the account is created but the user gets a "request submitted / pending approval" experience.

All user-facing text is **English**, added to `src/i18n/strings.ts` (consistent with the current app).

## Decisions (from brainstorming)

- **Signup semantics:** auto-registration that creates the user but grants **no data access until an admin approves** (chosen). Backend enforcement is **phase 2**; this delivery ships only the frontend + the "pending approval" UX.
- **Recovery:** build **both** halves — the "send reset email" request and the "set new password" landing.
- **Structure:** **Approach A** — one `AuthPage` with an internal `mode` (`signin | signup | forgot`); the reset-password landing is separate, driven by the Supabase `PASSWORD_RECOVERY` event.
- **Language:** English.

## Known limitation / security caveat (explicit)

Leg2's REST views are currently readable by **any `authenticated` user** (RLS granted to `authenticated`). Because this delivery is frontend-only, a user who self-registers and confirms their email **could read data** before phase-2 RLS hardening lands. The "pending approval" panel is **UX text, not enforcement**, until phase 2. This is accepted for this delivery and must be tracked as a follow-up.

**Phase-2 follow-up (out of scope here):** an approval flag (e.g. a `profiles` table or `app_metadata.approved`) plus RLS policies that check it, and a `Gate` check that blocks unapproved users.

**Dependency/assumption:** the Leg2 Supabase project must have email signups enabled and the reset-email redirect URL allow-listed (`window.location.origin`). If signups are disabled, `signUp` returns an error, which the UI surfaces via `friendlyAuthError`.

## Architecture

### Components / files

**New — `src/lib/auth.ts` (pure logic, unit-tested):**
- `validateEmail(s: string): string | null` — returns an error message key or `null`.
- `validatePassword(s: string): string | null` — rules (min length 8); returns error or `null`.
- `friendlyAuthError(error: { message: string } | null): string | null` — maps raw Supabase messages to friendly English text; unknown messages pass through.

**Extended — `src/contexts/AuthContext.tsx`:** keep `session`, `user`, `isLoading`, `signIn`, `signOut`; add:
- `signUp(email, password): Promise<{ error: string | null }>` → `supabase.auth.signUp`.
- `requestPasswordReset(email): Promise<{ error: string | null }>` → `supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })`.
- `updatePassword(password): Promise<{ error: string | null }>` → `supabase.auth.updateUser({ password })`.
- `isRecovery: boolean` — set `true` when `onAuthStateChange` fires `PASSWORD_RECOVERY`; cleared after a successful `updatePassword` or on `signOut`.
- All new methods route errors through `friendlyAuthError`.

**New — `src/components/auth/PasswordInput.tsx`:** wraps `ui/Input` with an eye / eye-off toggle button (`Eye` / `EyeOff` from lucide-react). Toggles `type` between `password` and `text`; button has an `aria-label` that switches between "Show password" / "Hide password". Reused in sign-in, sign-up, and reset.

**New — `src/pages/AuthPage.tsx`** (replaces `src/pages/LoginPage.tsx`): centered card holding `mode` state and the branding/title; renders the active sub-form and the mode-switch links ("Forgot password?", "Create account", "Back to sign in").

**New — `src/components/auth/` sub-forms** (small, testable):
- `SignInForm` — email + `PasswordInput` → `signIn`.
- `SignUpForm` — email + `PasswordInput` + confirm → validation → `signUp`; on success shows the pending-approval panel.
- `ForgotPasswordForm` — email → `requestPasswordReset`; always shows the same neutral confirmation.

**New — `src/pages/ResetPasswordPage.tsx`:** the reset-email landing. New password + confirm (both `PasswordInput`), validation + match check, `updatePassword`; on success clears recovery and falls through to the app (session already present).

**Modified — `src/App.tsx` (`Gate`):** ordering →
1. `isLoading` → loading.
2. `isRecovery` → `ResetPasswordPage`.
3. `!session` → `AuthPage`.
4. else → the app.

**Modified — `src/i18n/strings.ts`:** extend `auth` with keys for tabs/links, placeholders, recovery request + landing, signup, pending-approval panel, and error messages.

**Removed:** `src/pages/LoginPage.tsx` (superseded by `AuthPage`).

### Data flow & states

- **Sign in:** email + password → `signIn` → inline error, or `onAuthStateChange` sets the session and `Gate` swaps automatically.
- **Sign up:** validate email + password + confirm → `signUp`. With email confirmation on, `signUp` returns a user with **no session** → show the success/pending panel: *"Account requested. Check your email to confirm. Access is granted after an administrator approves your account."* Do not navigate into the app.
- **Forgot password:** email → `requestPasswordReset` with `redirectTo = window.location.origin`. Always show the same neutral message — *"If that email exists, we've sent a reset link."* — never reveal whether the account exists.
- **Reset password (landing):** `isRecovery === true` → `ResetPasswordPage`. New + confirm → validation + match → `updatePassword` → success → clear `isRecovery` → land in the app, authenticated.

### Error handling

- Every `AuthContext` method returns `{ error: string | null }` (existing pattern), passed through `friendlyAuthError`.
- Client-side validation runs **before** calling Supabase (malformed email, short password, non-matching confirm) → inline per-field messages.
- `busy` state disables submit and shows a "…ing" label (like today's `signingIn`).
- Recovery/forgot never leak account existence.

## Testing (Vitest + Testing Library — repo convention)

- `auth.test.ts` — validators and `friendlyAuthError`.
- `PasswordInput.test.tsx` — toggle flips `type` and `aria-label`.
- `AuthPage.test.tsx` — mode switching; each form calls the correct (mocked) context method; inline validation errors; pending panel after signup.
- `ResetPasswordPage.test.tsx` — mismatch blocks submit; `updatePassword` invoked; success path.
- `AuthContext.test.tsx` — extended: `PASSWORD_RECOVERY` sets `isRecovery`; new methods map errors.

## Visual direction ("modern")

Centered card (`max-w-sm`), soft border + shadow using existing tokens, app title/branding on top, generous spacing, a status icon in success/pending panels, password toggle icon. **No new libraries** — reuse the present shadcn UI + lucide-react. During implementation, apply the `frontend-design` skill so the result is intentional rather than templated.

## Out of scope (phase 2, tracked)

- Approval flag (`profiles` / `app_metadata.approved`) + RLS policies that enforce it.
- `Gate` check that blocks unapproved users from data.
- Any Leg2 database migration.
