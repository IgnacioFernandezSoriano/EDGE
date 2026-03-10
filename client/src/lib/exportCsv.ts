import { TrackingEvent } from './supabase';

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const COLUMNS: { key: keyof TrackingEvent; label: string }[] = [
  { key: 'id', label: 'ID' },
  { key: 's9id', label: 'Receptacle (s9id)' },
  { key: 'coverage_type', label: 'Coverage Type' },
  { key: 'has_rfid', label: 'Has RFID' },
  { key: 'has_predes', label: 'Has PREDES' },
  { key: 'has_resdes', label: 'Has RESDES' },
  { key: 'rfid_origin_impc', label: 'RFID Origin IMPC' },
  { key: 'rfid_origin_country', label: 'RFID Origin Country' },
  { key: 'rfid_origin_centre', label: 'RFID Origin Centre' },
  { key: 'rfid_origin_time', label: 'RFID Origin Time (UTC)' },
  { key: 'rfid_origin_readings', label: 'RFID Origin Readings' },
  { key: 'rfid_dest_impc', label: 'RFID Dest IMPC' },
  { key: 'rfid_dest_country', label: 'RFID Dest Country' },
  { key: 'rfid_dest_centre', label: 'RFID Dest Centre' },
  { key: 'rfid_dest_time', label: 'RFID Dest Time (UTC)' },
  { key: 'rfid_dest_readings', label: 'RFID Dest Readings' },
  { key: 'rfid_total_readings', label: 'RFID Total Readings' },
  { key: 'predes_time', label: 'PREDES Time' },
  { key: 'predes_origin_impc', label: 'PREDES Origin IMPC' },
  { key: 'predes_origin_country', label: 'PREDES Origin Country' },
  { key: 'predes_origin_centre', label: 'PREDES Origin Centre' },
  { key: 'redes_time', label: 'RESDES Time' },
  { key: 'redes_dest_impc', label: 'RESDES Dest IMPC' },
  { key: 'redes_dest_country', label: 'RESDES Dest Country' },
  { key: 'redes_dest_centre', label: 'RESDES Dest Centre' },
  { key: 'departure_lag_hours', label: 'Departure Lag (h)' },
  { key: 'arrival_lead_hours', label: 'Arrival Lead (h)' },
  { key: 'rfid_transit_hours', label: 'RFID Transit (h)' },
  { key: 'edi_transit_hours', label: 'EDI Transit (h)' },
  { key: 'transit_diff_hours', label: 'Transit Diff (h)' },
  { key: 'origin_match', label: 'Origin Match' },
  { key: 'dest_match', label: 'Dest Match' },
  { key: 'full_route_validated', label: 'Full Route Validated' },
];

export function exportToCsv(events: TrackingEvent[], filename = 'tracking_events.csv') {
  const header = COLUMNS.map(c => c.label).join(',');
  const rows = events.map(e =>
    COLUMNS.map(c => escapeCell(e[c.key])).join(',')
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
