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
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
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
