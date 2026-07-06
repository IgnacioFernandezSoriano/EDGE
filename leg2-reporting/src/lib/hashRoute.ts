export type Route =
  | { name: "report" }
  | { name: "receptacle"; s9: string }
  | { name: "gaps" }
  | { name: "comparisons" };

const RECEPTACLE_RE = /^#\/receptacle(?:\/(.*))?$/;
const GAPS_RE = /^#\/gaps\b/;
const COMPARISONS_RE = /^#\/comparisons\b/;

export function parseHash(hash: string): Route {
  const m = RECEPTACLE_RE.exec(hash);
  if (m) {
    const s9 = decodeURIComponent(m[1] ?? "").trim();
    return { name: "receptacle", s9 };
  }
  if (GAPS_RE.test(hash)) return { name: "gaps" };
  if (COMPARISONS_RE.test(hash)) return { name: "comparisons" };
  return { name: "report" };
}

export function receptacleHash(s9: string): string {
  return `#/receptacle/${encodeURIComponent(s9.trim())}`;
}

export function gapsHash(): string {
  return "#/gaps";
}

export function comparisonsHash(): string {
  return "#/comparisons";
}
