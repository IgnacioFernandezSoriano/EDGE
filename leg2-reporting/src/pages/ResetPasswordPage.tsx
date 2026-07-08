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
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
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
