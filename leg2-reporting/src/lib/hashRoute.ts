export type Route = { name: "report" } | { name: "receptacle"; s9: string } | { name: "settings" };

const RECEPTACLE_RE = /^#\/receptacle(?:\/(.*))?$/;

export function parseHash(hash: string): Route {
  if (hash === "#/settings") return { name: "settings" };
  const m = RECEPTACLE_RE.exec(hash);
  if (m) {
    const s9 = decodeURIComponent(m[1] ?? "").trim();
    return { name: "receptacle", s9 };
  }
  return { name: "report" };
}

export function receptacleHash(s9: string): string {
  return `#/receptacle/${encodeURIComponent(s9.trim())}`;
}
