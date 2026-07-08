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
