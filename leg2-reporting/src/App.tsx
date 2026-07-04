import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import LoginPage from "@/pages/LoginPage";
import RfidEventsPage from "@/pages/RfidEventsPage";
import { strings } from "@/i18n/strings";

function Gate() {
  const { session, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center">{strings.states.loading}</div>;
  return session ? <RfidEventsPage /> : <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
