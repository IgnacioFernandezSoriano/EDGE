import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { strings } from "@/i18n/strings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn(email, password);
    setError(error);
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={onSubmit} className="flex flex-col gap-3 w-72">
        <h1 className="text-lg font-semibold">{strings.auth.heading}</h1>
        <Label>{strings.auth.email}</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Label>{strings.auth.password}</Label>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={busy}>{busy ? strings.auth.signingIn : strings.auth.signIn}</Button>
      </form>
    </div>
  );
}
