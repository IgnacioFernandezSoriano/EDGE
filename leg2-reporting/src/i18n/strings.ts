// All user-facing English strings live here so a future i18n layer can swap
// them per locale without hunting through components. Checkpoint column names
// live in CHECKPOINT_LABELS (src/lib/checkpoints.ts) as their own dictionary.
// Terminology is the USER's, not IPC's (RFID Reader, RFID Tag, ...).
export const strings = {
  appTitle: "Leg2 RFID Reporting — RFID events",
  auth: {
    heading: "Leg2 RFID Reporting",
    email: "Email",
    password: "Password",
    signIn: "Sign in",
    signingIn: "Signing in…",
    signOut: "Sign out",
  },
  tabs: { inbound: "Inbound", outbound: "Outbound" },
  timeMode: { utc: "UTC", local: "Local" },
  filters: {
    origCountry: "Orig country",
    destCountry: "Dest country",
    s9: "S9",
    rfidTag: "RFID Tag",
    all: "All",
    searchS9: "Search S9",
    searchRfidTag: "Search RFID Tag",
  },
  columns: {
    s9: "S9",
    origImpc: "Origin IMPC",
    destImpc: "Destination IMPC",
    rfidTag: "RFID Tag",
    rfidReader: "RFID Reader",
    movementId: "Movement Id",
    time: "Time",
    site: "Site",
    handover: "Handover",
  },
  states: {
    loading: "Loading…",
    noRows: "No movements match the current filters.",
    selectS9: "Select an S9 to see its events.",
    eventDetails: "Event details",
    errorPrefix: "Error: ",
  },
} as const;
