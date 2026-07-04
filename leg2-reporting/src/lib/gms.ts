const DEFAULT_BASE = "https://monitoring.edgeavs.net/catalog";

export function readerMasterBase(): string {
  return (import.meta.env.VITE_GMS_READER_MASTER_URL as string | undefined) ?? DEFAULT_BASE;
}

/** Deep-link to the GMS IOT reader master (Operation tab) for a given LPI. */
export function buildReaderMasterUrl(lpi: string, base: string = readerMasterBase()): string {
  return `${base.replace(/\/$/, "")}/${encodeURIComponent(lpi)}`;
}
