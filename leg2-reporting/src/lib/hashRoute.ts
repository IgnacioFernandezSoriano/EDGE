export type Route =
  | { name: "report" }
  | { name: "receptacle"; s9: string }
  | { name: "gaps" }
  | { name: "settings" };

const RECEPTACLE_RE = /^#\/receptacle(?:\/(.*))?$/;
const GAPS_RE = /^#\/gaps\b/;

export function parseHash(hash: string): Route {
  if (hash === "#/settings") return { name: "settings" };
  const m = RECEPTACLE_RE.exec(hash);
  if (m) {
    const s9 = decodeURIComponent(m[1] ?? "").trim();
    return { name: "receptacle", s9 };
  }
  if (GAPS_RE.test(hash)) return { name: "gaps" };
  return { name: "report" };
}

export function receptacleHash(s9: string): string {
  return `#/receptacle/${encodeURIComponent(s9.trim())}`;
}

export function gapsHash(): string {
  return "#/gaps";
}

export function settingsHash(): string {
  return "#/settings";
}

export function receptacleUrl(s9: string): string {
  return `${window.location.pathname}${window.location.search}${receptacleHash(s9)}`;
}
