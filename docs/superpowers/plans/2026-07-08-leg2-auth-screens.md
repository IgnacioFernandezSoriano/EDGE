# Leg2 Auth Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal `LoginPage` with a modern single-card auth screen (sign in with show/hide password, self-registration "request", full password recovery), all wired to Supabase Auth.

**Architecture:** One `AuthPage` card with an internal `mode` (`signin | signup | forgot`) rendering small per-mode sub-forms; the password-reset landing is a separate `ResetPasswordPage` driven by the Supabase `PASSWORD_RECOVERY` event exposed as `isRecovery` on `AuthContext`. Pure validation/error-mapping lives in `lib/auth.ts`. Frontend only — no DB changes.

**Tech Stack:** React 19, Vite, Tailwind v4, shadcn-style UI (`ui/Input`, `ui/Button`), lucide-react, `@supabase/supabase-js`, Vitest + Testing Library.

## Global Constraints

- All user-facing text in **English**, added under `strings.auth` in `src/i18n/strings.ts`. Never hardcode display text in components — reference `strings.auth.*`.
- Every `AuthContext` async method returns `{ error: string | null }` where the message is already passed through `friendlyAuthError`.
- No new npm dependencies. Reuse existing `ui/*` components and lucide-react icons.
- Path alias: `@/` → `src/`.
- Test runner: `pnpm exec vitest run <file>`. Typecheck: `pnpm check`.
- Follow existing test idiom: `vi.hoisted` + `vi.mock("@/lib/supabase", …)` for context tests; `vi.mock("@/contexts/AuthContext", …)` for component tests.
- **Security caveat (do not "fix" here):** Leg2 views are readable by any `authenticated` user; the "pending approval" panel is UX text only. Real enforcement is phase 2 and out of scope.

---

### Task 1: Auth strings + `lib/auth.ts` (validators & error mapping)

**Files:**
- Modify: `leg2-reporting/src/i18n/strings.ts:7-14` (replace the `auth` block)
- Create: `leg2-reporting/src/lib/auth.ts`
- Test: `leg2-reporting/src/lib/auth.test.ts`

**Interfaces:**
- Consumes: `strings.auth` (extended in this task).
- Produces:
  - `validateEmail(email: string): string | null`
  - `validatePassword(password: string): string | null`
  - `friendlyAuthError(error: { message: string } | null | undefined): string | null`

- [ ] **Step 1: Replace the `auth` strings block**

In `src/i18n/strings.ts`, replace the current `auth: { … }` object (lines 7–14) with:

```ts
  auth: {
    heading: "Leg2 RFID Reporting",
    signInTitle: "Sign in to your account",
    signUpTitle: "Create an account",
    forgotTitle: "Reset your password",
    resetTitle: "Set a new password",
    email: "Email",
    password: "Password",
    confirmPassword: "Confirm password",
    newPassword: "New password",
    signIn: "Sign in",
    signingIn: "Signing in…",
    signUp: "Create account",
    signingUp: "Creating account…",
    sendReset: "Send reset link",
    sending: "Sending…",
    updatePassword: "Update password",
    updating: "Updating…",
    signOut: "Sign out",
    forgotLink: "Forgot password?",
    createAccountLink: "Create account",
    backToSignIn: "Back to sign in",
    showPassword: "Show password",
    hidePassword: "Hide password",
    signupPendingTitle: "Account requested",
    signupPendingBody:
      "Check your email to confirm your address. Access is granted after an administrator approves your account.",
    resetSentTitle: "Check your email",
    resetSentBody: "If that email exists, we've sent a reset link.",
    resetDoneTitle: "Password updated",
    resetDoneBody: "Your password has been changed.",
    errors: {
      invalidEmail: "Enter a valid email address.",
      passwordTooShort: "Password must be at least 8 characters.",
      passwordMismatch: "Passwords don't match.",
      invalidCredentials: "Incorrect email or password.",
      emailNotConfirmed: "Please confirm your email before signing in.",
      userExists: "An account with this email already exists.",
      signupDisabled: "Sign-ups are currently disabled. Contact an administrator.",
    },
  },
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/auth.test.ts`:

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/auth.test.ts`
Expected: FAIL — cannot find module `@/lib/auth`.

- [ ] **Step 4: Write minimal implementation**

Create `src/lib/auth.ts`:

```ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run src/lib/auth.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck & commit**

Run: `pnpm check` — Expected: no errors.

```bash
git add leg2-reporting/src/i18n/strings.ts leg2-reporting/src/lib/auth.ts leg2-reporting/src/lib/auth.test.ts
git commit -m "feat(leg2): auth strings + validators and friendly error mapping"
```

---

### Task 2: Extend `AuthContext` (signUp, requestPasswordReset, updatePassword, isRecovery)

**Files:**
- Modify: `leg2-reporting/src/contexts/AuthContext.tsx`
- Test: `leg2-reporting/src/contexts/AuthContext.test.tsx`

**Interfaces:**
- Consumes: `friendlyAuthError` from Task 1.
- Produces, on the `useAuth()` return value:
  - `isRecovery: boolean`
  - `signUp(email: string, password: string): Promise<{ error: string | null }>`
  - `requestPasswordReset(email: string): Promise<{ error: string | null }>`
  - `updatePassword(password: string): Promise<{ error: string | null }>`
  - (existing) `session`, `user`, `isLoading`, `signIn`, `signOut`

- [ ] **Step 1: Write the failing tests**

Replace `src/contexts/AuthContext.test.tsx` with:

```tsx
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/contexts/AuthContext.test.tsx`
Expected: FAIL — `ctx.signUp`/`ctx.isRecovery` undefined.

- [ ] **Step 3: Extend the implementation**

Replace `src/contexts/AuthContext.tsx` with:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { friendlyAuthError } from "@/lib/auth";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isRecovery: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecovery, setIsRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setIsRecovery(true);
      setSession(session);
      setIsLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: friendlyAuthError(error) };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: friendlyAuthError(error) };
  };

  const requestPasswordReset = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    return { error: friendlyAuthError(error) };
  };

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) setIsRecovery(false);
    return { error: friendlyAuthError(error) };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setIsRecovery(false);
  };

  const user = session?.user ?? null;

  return (
    <AuthContext.Provider
      value={{
        session, user, isLoading, isRecovery,
        signIn, signUp, requestPasswordReset, updatePassword, signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/contexts/AuthContext.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck & commit**

Run: `pnpm check` — Expected: no errors.

```bash
git add leg2-reporting/src/contexts/AuthContext.tsx leg2-reporting/src/contexts/AuthContext.test.tsx
git commit -m "feat(leg2): AuthContext gains signUp, reset, updatePassword, isRecovery"
```

---

### Task 3: `PasswordInput` component (show/hide toggle)

**Files:**
- Create: `leg2-reporting/src/components/auth/PasswordInput.tsx`
- Test: `leg2-reporting/src/components/auth/PasswordInput.test.tsx`

**Interfaces:**
- Consumes: `ui/Input`, `ui/Button`, `strings.auth.showPassword|hidePassword`, `cn`.
- Produces: `PasswordInput(props: Omit<React.ComponentProps<"input">, "type">): JSX.Element` — a password field with an eye toggle button.

- [ ] **Step 1: Write the failing test**

Create `src/components/auth/PasswordInput.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PasswordInput } from "@/components/auth/PasswordInput";

describe("PasswordInput", () => {
  it("starts hidden and toggles to visible", async () => {
    const user = userEvent.setup();
    render(<PasswordInput placeholder="Password" />);
    const input = screen.getByPlaceholderText("Password");
    expect(input).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Show password" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show password" }));

    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/auth/PasswordInput.test.tsx`
Expected: FAIL — cannot find module `@/components/auth/PasswordInput`.

- [ ] **Step 3: Write the implementation**

Create `src/components/auth/PasswordInput.tsx`:

```tsx
import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { strings } from "@/i18n/strings";
import { cn } from "@/lib/utils";

export function PasswordInput({
  className,
  ...props
}: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        className={cn("pr-9", className)}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
        aria-label={visible ? strings.auth.hidePassword : strings.auth.showPassword}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/auth/PasswordInput.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck & commit**

Run: `pnpm check` — Expected: no errors.

```bash
git add leg2-reporting/src/components/auth/PasswordInput.tsx leg2-reporting/src/components/auth/PasswordInput.test.tsx
git commit -m "feat(leg2): PasswordInput with accessible show/hide toggle"
```

---

### Task 4: `SignInForm`

**Files:**
- Create: `leg2-reporting/src/components/auth/SignInForm.tsx`
- Test: `leg2-reporting/src/components/auth/SignInForm.test.tsx`

**Interfaces:**
- Consumes: `useAuth().signIn`, `PasswordInput`, `validateEmail`, `ui/*`, `strings.auth`.
- Produces: `SignInForm(): JSX.Element` (no props).

- [ ] **Step 1: Write the failing test**

Create `src/components/auth/SignInForm.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/auth/SignInForm.test.tsx`
Expected: FAIL — cannot find module `@/components/auth/SignInForm`.

- [ ] **Step 3: Write the implementation**

Create `src/components/auth/SignInForm.tsx`:

```tsx
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { validateEmail } from "@/lib/auth";
import { strings } from "@/i18n/strings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/auth/PasswordInput";

export function SignInForm() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailErr = validateEmail(email);
    if (emailErr) return setError(emailErr);
    setBusy(true);
    setError(null);
    const { error } = await signIn(email, password);
    setError(error);
    setBusy(false);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signin-email">{strings.auth.email}</Label>
        <Input
          id="signin-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signin-password">{strings.auth.password}</Label>
        <PasswordInput
          id="signin-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy} className="mt-1">
        {busy ? strings.auth.signingIn : strings.auth.signIn}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/auth/SignInForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck & commit**

Run: `pnpm check` — Expected: no errors.

```bash
git add leg2-reporting/src/components/auth/SignInForm.tsx leg2-reporting/src/components/auth/SignInForm.test.tsx
git commit -m "feat(leg2): SignInForm with client-side email validation"
```

---

### Task 5: `SignUpForm` (self-registration + pending-approval panel)

**Files:**
- Create: `leg2-reporting/src/components/auth/SignUpForm.tsx`
- Test: `leg2-reporting/src/components/auth/SignUpForm.test.tsx`

**Interfaces:**
- Consumes: `useAuth().signUp`, `PasswordInput`, `validateEmail`, `validatePassword`, `strings.auth`.
- Produces: `SignUpForm(): JSX.Element` (no props).

- [ ] **Step 1: Write the failing test**

Create `src/components/auth/SignUpForm.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/auth/SignUpForm.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

Create `src/components/auth/SignUpForm.tsx`:

```tsx
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { validateEmail, validatePassword } from "@/lib/auth";
import { strings } from "@/i18n/strings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/auth/PasswordInput";

export function SignUpForm() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailErr = validateEmail(email);
    if (emailErr) return setError(emailErr);
    const pwErr = validatePassword(password);
    if (pwErr) return setError(pwErr);
    if (password !== confirm) return setError(strings.auth.errors.passwordMismatch);
    setBusy(true);
    setError(null);
    const { error } = await signUp(email, password);
    setBusy(false);
    if (error) return setError(error);
    setDone(true);
  };

  if (done) {
    return (
      <div className="flex flex-col items-center gap-2 text-center py-2">
        <CheckCircle2 className="size-8 text-primary" />
        <p className="font-medium">{strings.auth.signupPendingTitle}</p>
        <p className="text-sm text-muted-foreground">{strings.auth.signupPendingBody}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-email">{strings.auth.email}</Label>
        <Input
          id="signup-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-password">{strings.auth.password}</Label>
        <PasswordInput
          id="signup-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-confirm">{strings.auth.confirmPassword}</Label>
        <PasswordInput
          id="signup-confirm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy} className="mt-1">
        {busy ? strings.auth.signingUp : strings.auth.signUp}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/auth/SignUpForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck & commit**

Run: `pnpm check` — Expected: no errors.

```bash
git add leg2-reporting/src/components/auth/SignUpForm.tsx leg2-reporting/src/components/auth/SignUpForm.test.tsx
git commit -m "feat(leg2): SignUpForm with validation and pending-approval panel"
```

---

### Task 6: `ForgotPasswordForm`

**Files:**
- Create: `leg2-reporting/src/components/auth/ForgotPasswordForm.tsx`
- Test: `leg2-reporting/src/components/auth/ForgotPasswordForm.test.tsx`

**Interfaces:**
- Consumes: `useAuth().requestPasswordReset`, `validateEmail`, `strings.auth`.
- Produces: `ForgotPasswordForm(): JSX.Element` (no props).

- [ ] **Step 1: Write the failing test**

Create `src/components/auth/ForgotPasswordForm.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/auth/ForgotPasswordForm.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

Create `src/components/auth/ForgotPasswordForm.tsx`:

```tsx
import { useState } from "react";
import { MailCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { validateEmail } from "@/lib/auth";
import { strings } from "@/i18n/strings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailErr = validateEmail(email);
    if (emailErr) return setError(emailErr);
    setBusy(true);
    setError(null);
    // Do not surface the returned error: never reveal whether the account exists.
    await requestPasswordReset(email);
    setBusy(false);
    setSent(true);
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-2 text-center py-2">
        <MailCheck className="size-8 text-primary" />
        <p className="font-medium">{strings.auth.resetSentTitle}</p>
        <p className="text-sm text-muted-foreground">{strings.auth.resetSentBody}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="forgot-email">{strings.auth.email}</Label>
        <Input
          id="forgot-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy} className="mt-1">
        {busy ? strings.auth.sending : strings.auth.sendReset}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/auth/ForgotPasswordForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck & commit**

Run: `pnpm check` — Expected: no errors.

```bash
git add leg2-reporting/src/components/auth/ForgotPasswordForm.tsx leg2-reporting/src/components/auth/ForgotPasswordForm.test.tsx
git commit -m "feat(leg2): ForgotPasswordForm with enumeration-safe confirmation"
```

---

### Task 7: `AuthPage` card container (mode switching)

**Files:**
- Create: `leg2-reporting/src/pages/AuthPage.tsx`
- Test: `leg2-reporting/src/pages/AuthPage.test.tsx`

**Interfaces:**
- Consumes: `SignInForm`, `SignUpForm`, `ForgotPasswordForm`, `ui/Button`, `strings.auth`.
- Produces: default export `AuthPage(): JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `src/pages/AuthPage.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/pages/AuthPage.test.tsx`
Expected: FAIL — cannot find module `@/pages/AuthPage`.

- [ ] **Step 3: Write the implementation**

Create `src/pages/AuthPage.tsx`:

```tsx
import { useState } from "react";
import { strings } from "@/i18n/strings";
import { Button } from "@/components/ui/button";
import { SignInForm } from "@/components/auth/SignInForm";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

type Mode = "signin" | "signup" | "forgot";

const SUBTITLE: Record<Mode, string> = {
  signin: strings.auth.signInTitle,
  signup: strings.auth.signUpTitle,
  forgot: strings.auth.forgotTitle,
};

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("signin");

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card text-card-foreground shadow-sm p-6 flex flex-col gap-5">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-xl font-semibold">{strings.auth.heading}</h1>
          <p className="text-sm text-muted-foreground">{SUBTITLE[mode]}</p>
        </div>

        {mode === "signin" && <SignInForm />}
        {mode === "signup" && <SignUpForm />}
        {mode === "forgot" && <ForgotPasswordForm />}

        <div className="flex flex-col items-center gap-1 text-sm">
          {mode === "signin" && (
            <>
              <Button variant="link" size="sm" onClick={() => setMode("forgot")}>
                {strings.auth.forgotLink}
              </Button>
              <Button variant="link" size="sm" onClick={() => setMode("signup")}>
                {strings.auth.createAccountLink}
              </Button>
            </>
          )}
          {mode !== "signin" && (
            <Button variant="link" size="sm" onClick={() => setMode("signin")}>
              {strings.auth.backToSignIn}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/pages/AuthPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck & commit**

Run: `pnpm check` — Expected: no errors.

```bash
git add leg2-reporting/src/pages/AuthPage.tsx leg2-reporting/src/pages/AuthPage.test.tsx
git commit -m "feat(leg2): AuthPage card with signin/signup/forgot mode switching"
```

---

### Task 8: `ResetPasswordPage` (reset-email landing)

**Files:**
- Create: `leg2-reporting/src/pages/ResetPasswordPage.tsx`
- Test: `leg2-reporting/src/pages/ResetPasswordPage.test.tsx`

**Interfaces:**
- Consumes: `useAuth().updatePassword`, `PasswordInput`, `validatePassword`, `strings.auth`.
- Produces: default export `ResetPasswordPage(): JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `src/pages/ResetPasswordPage.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/pages/ResetPasswordPage.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

Create `src/pages/ResetPasswordPage.tsx`:

```tsx
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { validatePassword } from "@/lib/auth";
import { strings } from "@/i18n/strings";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/auth/PasswordInput";

export default function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pwErr = validatePassword(password);
    if (pwErr) return setError(pwErr);
    if (password !== confirm) return setError(strings.auth.errors.passwordMismatch);
    setBusy(true);
    setError(null);
    const { error } = await updatePassword(password);
    setBusy(false);
    if (error) return setError(error);
    setDone(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card text-card-foreground shadow-sm p-6 flex flex-col gap-5">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-xl font-semibold">{strings.auth.heading}</h1>
          <p className="text-sm text-muted-foreground">{strings.auth.resetTitle}</p>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-2 text-center py-2">
            <CheckCircle2 className="size-8 text-primary" />
            <p className="font-medium">{strings.auth.resetDoneTitle}</p>
            <p className="text-sm text-muted-foreground">{strings.auth.resetDoneBody}</p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reset-password">{strings.auth.newPassword}</Label>
              <PasswordInput
                id="reset-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reset-confirm">{strings.auth.confirmPassword}</Label>
              <PasswordInput
                id="reset-confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy} className="mt-1">
              {busy ? strings.auth.updating : strings.auth.updatePassword}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/pages/ResetPasswordPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck & commit**

Run: `pnpm check` — Expected: no errors.

```bash
git add leg2-reporting/src/pages/ResetPasswordPage.tsx leg2-reporting/src/pages/ResetPasswordPage.test.tsx
git commit -m "feat(leg2): ResetPasswordPage for the reset-email landing"
```

---

### Task 9: Wire the `Gate`, remove `LoginPage`

**Files:**
- Modify: `leg2-reporting/src/App.tsx`
- Modify: `leg2-reporting/src/App.test.tsx`
- Delete: `leg2-reporting/src/pages/LoginPage.tsx`

**Interfaces:**
- Consumes: `AuthPage` (Task 7), `ResetPasswordPage` (Task 8), `useAuth().isRecovery` (Task 2).
- Produces: no new exports.

- [ ] **Step 1: Update the App test mock to include `isRecovery`**

In `src/App.test.tsx`, the `vi.mock("@/contexts/AuthContext", …)` `useAuth` return must include `isRecovery: false`. Change the mocked object (around line 8) to:

```tsx
  useAuth: () => ({ session: { user: { email: "t@example.com" } }, user: { email: "t@example.com" }, isLoading: false, isRecovery: false, signOut: vi.fn() }),
```

- [ ] **Step 2: Run the App test to confirm it still passes**

Run: `pnpm exec vitest run src/App.test.tsx`
Expected: PASS (mock now matches the widened type; behavior unchanged).

- [ ] **Step 3: Rewire the `Gate` and swap `LoginPage` → `AuthPage`**

In `src/App.tsx`:

1. Replace the import `import LoginPage from "@/pages/LoginPage";` with:

```tsx
import AuthPage from "@/pages/AuthPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
```

2. In `Gate()`, change the destructure and the guard block:

```tsx
  const { session, isLoading, isRecovery, signOut, user } = useAuth();
  const route = useRoute();
  if (isLoading)
    return <div className="min-h-screen flex items-center justify-center">{strings.states.loading}</div>;
  if (isRecovery) return <ResetPasswordPage />;
  if (!session) return <AuthPage />;
```

- [ ] **Step 4: Delete the obsolete `LoginPage`**

```bash
git rm leg2-reporting/src/pages/LoginPage.tsx
```

- [ ] **Step 5: Run the full test suite + typecheck**

Run: `pnpm exec vitest run` — Expected: all suites PASS (including the new auth suites).
Run: `pnpm check` — Expected: no errors (no dangling `LoginPage` import).

- [ ] **Step 6: Commit**

```bash
git add leg2-reporting/src/App.tsx leg2-reporting/src/App.test.tsx
git commit -m "feat(leg2): Gate renders AuthPage + ResetPasswordPage; drop LoginPage"
```

---

## Self-Review

**Spec coverage:**
- Modern single-card login → Task 7 (`AuthPage`). ✓
- Show/hide password → Task 3 (`PasswordInput`), used in Tasks 4, 5, 8. ✓
- Password recovery request → Task 6 (`ForgotPasswordForm`) + Task 2 `requestPasswordReset`. ✓
- Set-new-password landing → Task 8 (`ResetPasswordPage`) + Task 2 `isRecovery` + Task 9 Gate. ✓
- Sign up ("alta") + pending-approval UX → Task 5 (`SignUpForm`) + Task 2 `signUp`. ✓
- Supabase integration → Task 2 (all methods on `supabase.auth`). ✓
- English strings in `strings.ts` → Task 1. ✓
- Enumeration-safe recovery → Task 6 (ignores returned error, neutral message). ✓
- Frontend-only / no DB changes → no task touches Supabase migrations. ✓
- Security caveat documented → Global Constraints + spec. ✓

**Placeholder scan:** No TBD/TODO; every code and test step contains full content. ✓

**Type consistency:** `AuthContextType` method names (`signIn`, `signUp`, `requestPasswordReset`, `updatePassword`, `isRecovery`) are defined in Task 2 and consumed verbatim in Tasks 4–9. `PasswordInput` prop type `Omit<ComponentProps<"input">, "type">` is consistent across usages. `{ error: string | null }` return shape is uniform. ✓

## Phase 2 (out of scope, tracked)

Approval flag (`profiles` / `app_metadata.approved`) + RLS policies enforcing it + `Gate` check that blocks unapproved users from data. Requires confirming and writing to the Leg2 Supabase project (`ubgatxfwpmyaqyfrwias`).
