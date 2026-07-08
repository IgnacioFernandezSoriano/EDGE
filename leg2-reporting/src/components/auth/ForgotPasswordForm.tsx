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
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
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
