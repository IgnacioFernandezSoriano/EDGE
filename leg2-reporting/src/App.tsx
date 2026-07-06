import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import LoginPage from "@/pages/LoginPage";
import RfidEventsPage from "@/pages/RfidEventsPage";
import AtatPage from "@/pages/AtatPage";
import EventGapsPage from "@/pages/EventGapsPage";
import { parseHash, type Route } from "@/lib/hashRoute";
import { strings } from "@/i18n/strings";
import { Button } from "@/components/ui/button";

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

function Nav({ route }: { route: Route }) {
  const go = (hash: string) => { window.location.hash = hash; };
  return (
    <nav className="flex items-center gap-1">
      <Button
        variant={route.name === "report" ? "default" : "outline"}
        size="sm"
        onClick={() => go("#/")}
      >
        {strings.atat.navReport}
      </Button>
      <Button
        variant={route.name === "receptacle" ? "default" : "outline"}
        size="sm"
        onClick={() => go("#/receptacle")}
      >
        {strings.atat.navReceptacle}
      </Button>
      <Button
        variant={route.name === "gaps" ? "default" : "outline"}
        size="sm"
        onClick={() => go("#/gaps")}
      >
        {strings.gaps.nav}
      </Button>
    </nav>
  );
}

function Gate() {
  const { session, isLoading, signOut, user } = useAuth();
  const route = useRoute();
  if (isLoading)
    return <div className="min-h-screen flex items-center justify-center">{strings.states.loading}</div>;
  if (!session) return <LoginPage />;

  return (
    <div className="h-screen flex flex-col">
      <header className="shrink-0 flex items-center justify-between gap-4 p-4 border-b">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold">{strings.appTitle}</h1>
          <Nav route={route} />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{user?.email}</span>
          <Button variant="outline" size="sm" onClick={() => signOut()}>{strings.auth.signOut}</Button>
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-auto">
        {route.name === "gaps"
          ? <EventGapsPage />
          : route.name === "receptacle"
            ? <AtatPage s9={route.s9 || null} />
            : <RfidEventsPage />}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
