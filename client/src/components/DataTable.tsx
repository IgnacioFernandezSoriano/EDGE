import { useState, useMemo } from 'react';
import { TrackingEvent } from '@/lib/supabase';

const COVERAGE_COLORS: Record<string, string> = {
  FULL: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RFID_PREDES: 'bg-blue-50 text-blue-700 border-blue-200',
  RFID_RESDES: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  RFID_ONLY: 'bg-amber-50 text-amber-700 border-amber-200',
  EDI_ONLY: 'bg-slate-100 text-slate-600 border-slate-200',
};

function formatHours(h: number | null): string {
  if (h === null || h === undefined) return '—';
  const abs = Math.abs(h);
  const sign = h < 0 ? '−' : '+';
  if (abs < 24) return `${sign}${abs.toFixed(1)}h`;
  return `${sign}${(abs / 24).toFixed(1)}d`;
}

function formatTime(t: string | null): string {
  if (!t) return '—';
  return new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

interface DataTableProps {
  events: TrackingEvent[];
  filterCoverage?: string;
}

export function DataTable({ events, filterCoverage }: DataTableProps) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [sortCol, setSortCol] = useState<string>('id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const pageSize = 20;

  const filtered = useMemo(() => {
    let data = events;
    if (filterCoverage && filterCoverage !== 'ALL') {
      data = data.filter(e => e.coverage_type === filterCoverage);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      data = data.filter(e =>
        (e.s9id || '').toLowerCase().includes(q) ||
        (e.rfid_origin_country || '').toLowerCase().includes(q) ||
        (e.redes_dest_country || '').toLowerCase().includes(q) ||
        (e.rfid_origin_centre || '').toLowerCase().includes(q) ||
        (e.redes_dest_centre || '').toLowerCase().includes(q)
      );
    }
    // Sort
    data = [...data].sort((a, b) => {
      const av = (a as any)[sortCol];
      const bv = (b as any)[sortCol];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return data;
  }, [events, filterCoverage, search, sortCol, sortDir]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const pageData = filtered.slice(page * pageSize, (page + 1) * pageSize);

  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
    setPage(0);
  }

  const SortIcon = ({ col }: { col: string }) => (
    <span className="ml-1 text-slate-400 text-xs">
      {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search by s9id, country, or centre..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
          className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
        />
        <span className="text-xs text-slate-400 whitespace-nowrap">{filtered.length.toLocaleString()} records</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {[
                { key: 'coverage_type', label: 'Coverage' },
                { key: 's9id', label: 'Receptacle (s9id)' },
                { key: 'rfid_origin_country', label: 'RFID Origin' },
                { key: 'rfid_origin_centre', label: 'Origin Centre' },
                { key: 'rfid_origin_time', label: 'RFID Departure' },
                { key: 'predes_time', label: 'PREDES' },
                { key: 'departure_lag_hours', label: 'Dep. Lag' },
                { key: 'redes_dest_country', label: 'EDI Destination' },
                { key: 'redes_dest_centre', label: 'Dest. Centre' },
                { key: 'redes_time', label: 'RESDES' },
                { key: 'arrival_lead_hours', label: 'Arr. Lead' },
                { key: 'rfid_transit_hours', label: 'RFID Transit' },
                { key: 'edi_transit_hours', label: 'EDI Transit' },
              ].map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="px-3 py-2.5 text-left font-semibold text-slate-600 whitespace-nowrap cursor-pointer hover:text-slate-900 select-none"
                >
                  {col.label}<SortIcon col={col.key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.map((e, i) => (
              <tr key={e.id} className={`border-b border-slate-100 hover:bg-slate-50/60 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                <td className="px-3 py-2">
                  <span className={`status-pill border text-[10px] ${COVERAGE_COLORS[e.coverage_type] || 'bg-slate-100 text-slate-600'}`}>
                    {e.coverage_type?.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-3 py-2 mono-value text-slate-700 max-w-[180px] truncate" title={e.s9id}>{e.s9id}</td>
                <td className="px-3 py-2 text-slate-600">{e.rfid_origin_country || '—'}</td>
                <td className="px-3 py-2 text-slate-600 max-w-[140px] truncate" title={e.rfid_origin_centre || ''}>{e.rfid_origin_centre || '—'}</td>
                <td className="px-3 py-2 mono-value text-slate-500">{formatTime(e.rfid_origin_time)}</td>
                <td className="px-3 py-2 mono-value text-slate-500">{formatTime(e.predes_time)}</td>
                <td className={`px-3 py-2 mono-value font-medium ${e.departure_lag_hours !== null ? (e.departure_lag_hours < 0 ? 'text-rose-600' : 'text-slate-700') : 'text-slate-400'}`}>
                  {formatHours(e.departure_lag_hours)}
                </td>
                <td className="px-3 py-2 text-slate-600">{e.redes_dest_country || '—'}</td>
                <td className="px-3 py-2 text-slate-600 max-w-[140px] truncate" title={e.redes_dest_centre || ''}>{e.redes_dest_centre || '—'}</td>
                <td className="px-3 py-2 mono-value text-slate-500">{formatTime(e.redes_time)}</td>
                <td className={`px-3 py-2 mono-value font-medium ${e.arrival_lead_hours !== null ? (e.arrival_lead_hours < 0 ? 'text-emerald-600' : 'text-amber-600') : 'text-slate-400'}`}>
                  {formatHours(e.arrival_lead_hours)}
                </td>
                <td className="px-3 py-2 mono-value text-slate-600">{formatHours(e.rfid_transit_hours)}</td>
                <td className="px-3 py-2 mono-value text-slate-600">{formatHours(e.edi_transit_hours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Page {page + 1} of {totalPages}</span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
            >«</button>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
            >‹</button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
            >›</button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={page >= totalPages - 1}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
            >»</button>
          </div>
        </div>
      )}
    </div>
  );
}
