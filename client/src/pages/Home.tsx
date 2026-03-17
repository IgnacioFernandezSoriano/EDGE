/**
 * EDGE RFID-EDI Analysis Dashboard
 * Design: Operational Intelligence — clean white + slate + indigo accent
 * Font: DM Sans (body) + Inter (headings/numbers) + JetBrains Mono (data)
 * Data source: Supabase tracking_events table
 * Features: global date filter, CSV export, EDGE by GMS logo
 */

import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ReferenceLine, LabelList,
  ScatterChart, Scatter, ZAxis,
  LineChart, Line, Area, AreaChart,
} from 'recharts';
import { useTrackingData } from '@/hooks/useTrackingData';
import { useEpcisData } from '@/hooks/useEpcisData';
import { useBenchmarkData } from '@/hooks/useBenchmarkData';
import { fetchMatchedTagsCount, supabase } from '@/lib/supabase';
import { KpiCard } from '@/components/KpiCard';
import { DataTable } from '@/components/DataTable';
import { EpcisDataTable } from '@/components/EpcisDataTable';
import { GlobalFilters } from '@/components/GlobalFilters';
import { InfoTooltip } from '@/components/InfoTooltip';
import { OverviewAnalysis, DepartureAnalysis, ArrivalAnalysis, TransitAnalysis } from '@/components/AnalysisPanel';
import { BenchmarkPanel } from '@/components/BenchmarkPanel';
import { SearchID } from '@/components/SearchID';

const EDGE_LOGO = 'https://d2xsxph8kpxj0f.cloudfront.net/108732851/5NdCdX6TpQ4zqErLoimWrK/edge-logo_ae84570f.png';

/* ─── Color palette ─── */
const C = {
  indigo:  '#4F46E5',
  emerald: '#10B981',
  amber:   '#F59E0B',
  rose:    '#F43F5E',
  sky:     '#0EA5E9',
  slate:   '#64748B',
};

const COVERAGE_FILL: Record<string, string> = {
  FULL:        C.emerald,
  EDI_FULL:    C.slate,
  RFID_PREDES: C.sky,
  RFID_RESDES: C.indigo,
  RFID_ONLY:   C.amber,
  EDI_ONLY:    '#cbd5e1',
};

const COVERAGE_LABEL: Record<string, string> = {
  FULL:        'RFID + PREDES + RESDES',
  EDI_FULL:    'PREDES + RESDES (no RFID)',
  RFID_PREDES: 'RFID + PREDES only',
  RFID_RESDES: 'RFID + RESDES only',
  RFID_ONLY:   'RFID only (no EDI)',
  EDI_ONLY:    'EDI only (no RFID)',
};

const TABS = ['RFID', 'Benchmark'];

/* ─── Tooltip ─── */
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs max-w-[220px]">
      {label !== undefined && <p className="font-semibold text-slate-700 mb-1.5 truncate">{label}</p>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-1.5 mb-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.fill }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-medium text-slate-800 ml-auto pl-2">
            {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
            {(p.name?.toLowerCase().includes('hour') || p.name?.toLowerCase().includes('lag') ||
              p.name?.toLowerCase().includes('lead') || p.name?.toLowerCase().includes('transit')) ? 'h' : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="border-b border-slate-200 pb-3">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function ChartCard({ title, subtitle, tooltip, children, className = '' }: { title: string; subtitle?: string; tooltip?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-lg border border-slate-200 p-5 shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-800 leading-tight">{title}</h3>
        {tooltip && <InfoTooltip content={tooltip} wide />}
      </div>
      {subtitle && <p className="text-xs text-slate-400 mt-0.5 mb-4">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </div>
  );
}

function InfoBox({ color, children }: { color: 'indigo' | 'emerald' | 'amber'; children: React.ReactNode }) {
  const styles = {
    indigo:  'bg-indigo-50 border-indigo-100 text-indigo-800',
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-800',
    amber:   'bg-amber-50 border-amber-100 text-amber-800',
  };
  return (
    <div className={`border rounded-lg p-4 text-xs leading-relaxed ${styles[color]}`}>
      {children}
    </div>
  );
}

/* ─── Active filter banner ─── */
function FilterBanner({
  from, to, originCountry, destCountry, count, total
}: {
  from: string | null; to: string | null;
  originCountry: string | null; destCountry: string | null;
  count: number; total: number;
}) {
  const parts: string[] = [];
  if (from && to) parts.push(`dates ${from} → ${to}`);
  else if (from) parts.push(`from ${from}`);
  else if (to) parts.push(`up to ${to}`);
  if (originCountry) parts.push(`origin: ${originCountry}`);
  if (destCountry) parts.push(`destination: ${destCountry}`);
  if (parts.length === 0) return null;
  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2.5 flex items-center gap-3 text-xs">
      <svg className="w-4 h-4 text-indigo-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
      </svg>
      <span className="text-indigo-700">
        <strong>Filters active:</strong> {parts.join(' · ')} — showing <strong>{count.toLocaleString()}</strong> of {total.toLocaleString()} receptacles
      </span>
    </div>
  );
}

/* ─── Admin Panel ─── */
type AccessRequest = {
  id: number;
  email: string;
  full_name: string;
  organization: string | null;
  country: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
};

type AuthUser = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  user_metadata: { role?: string; country?: string; full_name?: string };
};

function AdminPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'users' | 'requests'>('requests');
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // New user form
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newCountry, setNewCountry] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [newPwd, setNewPwd] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const loadData = async () => {
    setLoadingData(true);
    const [reqRes, usersRes] = await Promise.all([
      supabase.from('access_requests').select('*').order('created_at', { ascending: false }),
      supabase.rpc('admin_list_users').select('*'),
    ]);
    if (reqRes.data) setRequests(reqRes.data as AccessRequest[]);
    // admin_list_users may not exist yet — fallback gracefully
    if (usersRes.data) setUsers(usersRes.data as AuthUser[]);
    setLoadingData(false);
  };

  useEffect(() => { loadData(); }, []);

  const updateRequestStatus = async (id: number, status: 'approved' | 'rejected') => {
    setActionLoading(id);
    await supabase.from('access_requests').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id);
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    setActionLoading(null);
    showToast(status === 'approved' ? 'Request approved' : 'Request rejected');
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingUser(true);
    const metadata = newRole === 'admin'
      ? { role: 'admin', full_name: newName }
      : { country: newCountry, full_name: newName };
    const { error } = await supabase.auth.admin.createUser({
      email: newEmail,
      password: newPwd,
      user_metadata: metadata,
      email_confirm: true,
    });
    setCreatingUser(false);
    if (error) { showToast('Error: ' + error.message); }
    else {
      showToast('User created successfully');
      setNewEmail(''); setNewName(''); setNewCountry(''); setNewPwd(''); setNewRole('user');
      loadData();
    }
  };

  const statusBadge = (s: string) => {
    if (s === 'pending') return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Pending</span>;
    if (s === 'approved') return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Approved</span>;
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Rejected</span>;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-800">User Management</h2>
            <p className="text-xs text-slate-400 mt-0.5">Manage users and access requests</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 px-6 flex-shrink-0">
          {(['requests', 'users'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`py-3 px-1 mr-6 text-sm font-medium border-b-2 transition ${
                tab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              {t === 'requests' ? `Access Requests${requests.filter(r => r.status === 'pending').length > 0 ? ` (${requests.filter(r => r.status === 'pending').length})` : ''}` : 'Users'}
            </button>
          ))}
        </div>

        {/* Toast */}
        {toast && (
          <div className="mx-6 mt-3 p-2.5 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700 flex-shrink-0">{toast}</div>
        )}

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loadingData ? (
            <div className="flex items-center justify-center py-12">
              <svg className="animate-spin w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            </div>
          ) : (
            <>
              {/* ── ACCESS REQUESTS TAB ── */}
              {tab === 'requests' && (
                <div className="space-y-3">
                  {requests.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-8">No access requests yet.</p>
                  ) : requests.map(req => (
                    <div key={req.id} className="border border-slate-200 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-slate-800">{req.full_name}</span>
                            {statusBadge(req.status)}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">{req.email}</p>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                            <span className="text-xs text-slate-600"><span className="font-medium">Country:</span> {req.country}</span>
                            {req.organization && <span className="text-xs text-slate-600"><span className="font-medium">Org:</span> {req.organization}</span>}
                          </div>
                          {req.reason && <p className="text-xs text-slate-500 mt-1.5 italic">"{req.reason}"</p>}
                          <p className="text-xs text-slate-400 mt-1">{new Date(req.created_at).toLocaleDateString()}</p>
                        </div>
                        {req.status === 'pending' && (
                          <div className="flex gap-2 flex-shrink-0">
                            <button onClick={() => updateRequestStatus(req.id, 'approved')} disabled={actionLoading === req.id}
                              className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-xs font-semibold transition">
                              {actionLoading === req.id ? '…' : 'Approve'}
                            </button>
                            <button onClick={() => updateRequestStatus(req.id, 'rejected')} disabled={actionLoading === req.id}
                              className="px-3 py-1.5 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 text-xs font-semibold transition">
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── USERS TAB ── */}
              {tab === 'users' && (
                <div className="space-y-5">
                  {/* Create new user form */}
                  <div className="border border-slate-200 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-slate-700 mb-3">Create new user</h3>
                    <form onSubmit={handleCreateUser} className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Full name</label>
                        <input type="text" required value={newName} onChange={e => setNewName(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="John Smith" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                        <input type="email" required value={newEmail} onChange={e => setNewEmail(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="user@example.com" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>
                        <select value={newRole} onChange={e => setNewRole(e.target.value as 'user' | 'admin')}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                          <option value="user">Country user</option>
                          <option value="admin">Administrator</option>
                        </select>
                      </div>
                      {newRole === 'user' && (
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Country</label>
                          <input type="text" required={newRole === 'user'} value={newCountry} onChange={e => setNewCountry(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. Spain" />
                        </div>
                      )}
                      <div className={newRole === 'admin' ? 'col-span-2' : ''}>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Temporary password</label>
                        <input type="text" required value={newPwd} onChange={e => setNewPwd(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Min. 8 characters" />
                      </div>
                      <div className="col-span-2 flex justify-end">
                        <button type="submit" disabled={creatingUser}
                          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-semibold transition">
                          {creatingUser ? 'Creating…' : 'Create user'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Change Password Modal ─── */
function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { updatePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPwd.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (newPwd !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    const { error } = await updatePassword(newPwd);
    setLoading(false);
    if (error) { setError(error); } else { setSuccess(true); setTimeout(onClose, 2000); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-sm mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-slate-800">Change password</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        {success ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <p className="text-sm text-slate-600">Password updated successfully.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">New password</label>
              <div className="relative">
                <input type={showNew ? 'text' : 'password'} required value={newPwd} onChange={e => setNewPwd(e.target.value)}
                  className="w-full px-3 py-2 pr-10 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="••••••••" />
                <button type="button" onClick={() => setShowNew(v => !v)} tabIndex={-1}
                  className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-600">
                  {showNew
                    ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  }
                </button>
              </div>
              {newPwd.length > 0 && (
                <div className="flex gap-1 mt-1.5">
                  {[1,2,3,4].map(l => (
                    <div key={l} className={`h-1 flex-1 rounded-full ${newPwd.length >= l*3 ? l<=1?'bg-red-400':l<=2?'bg-yellow-400':l<=3?'bg-blue-400':'bg-green-500' : 'bg-slate-200'}`} />
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Confirm new password</label>
              <div className="relative">
                <input type={showConfirm ? 'text' : 'password'} required value={confirm} onChange={e => setConfirm(e.target.value)}
                  className="w-full px-3 py-2 pr-10 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="••••••••" />
                <button type="button" onClick={() => setShowConfirm(v => !v)} tabIndex={-1}
                  className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-600">
                  {showConfirm
                    ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  }
                </button>
              </div>
            </div>
            {error && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
                <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition">Cancel</button>
              <button type="submit" disabled={loading} className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-semibold transition">
                {loading ? 'Saving…' : 'Update'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ─── User menu (logout + user info) ─── */
function UserMenu() {
  const { user, isAdmin, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  return (
    <>
    {showChangePwd && <ChangePasswordModal onClose={() => setShowChangePwd(false)} />}
    {showAdminPanel && <AdminPanel onClose={() => setShowAdminPanel(false)} />}
    <div className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition text-sm"
      >
        <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center">
          <span className="text-xs font-bold text-indigo-700">
            {user?.email?.[0]?.toUpperCase() ?? '?'}
          </span>
        </div>
        <span className="hidden sm:block text-slate-700 font-medium max-w-[120px] truncate">
          {user?.user_metadata?.full_name ?? user?.email}
        </span>
        {isAdmin && (
          <span className="hidden sm:block text-[10px] font-bold uppercase tracking-wider text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">
            Admin
          </span>
        )}
        <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Dropdown */}
          <div className="absolute right-0 mt-2 w-60 bg-white rounded-xl shadow-lg border border-slate-200 z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-xs text-slate-400">Signed in as</p>
              <p className="text-sm font-semibold text-slate-800 truncate">{user?.email}</p>
              {isAdmin && <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">Administrator</span>}
            </div>
            <div className="py-1">
              {/* Change password */}
              <button
                onClick={() => { setOpen(false); setShowChangePwd(true); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition"
              >
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                Change password
              </button>
              {/* Admin panel — solo visible para admins */}
              {isAdmin && (
                <button
                  onClick={() => { setOpen(false); setShowAdminPanel(true); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition"
                >
                  <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  User management
                </button>
              )}
              {/* Audit de Carga de Datos — solo visible para admins */}
              {isAdmin && (
                <a
                  href="/admin/audit"
                  onClick={() => setOpen(false)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition"
                >
                  <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  Audit de Carga de Datos
                  <span className="ml-auto text-[10px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">Admin</span>
                </a>
              )}
            </div>
            <div className="border-t border-slate-100">
              <button
                onClick={signOut}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
    </>
  );
}

export default function Home() {
  const {
    events, allEvents, stats, loading, error,
    dateRange, setDateRange, allDataBounds,
    effectiveDateRange,
    originCountry, setOriginCountry,
    destCountry, setDestCountry,
  } = useTrackingData();
  const [activeTab, setActiveTab] = useState('RFID');
  const [tableFilter, setTableFilter] = useState('ALL');

  /* Matched Tags count from ID Relation table */
  const [matchedTagsData, setMatchedTagsData] = useState<{ count: number; minDate: string | null; maxDate: string | null } | null>(null);
  // Build country→IMPC map from allEvents
  const countryToImpc = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const e of allEvents) {
      if (e.predes_origin_country && e.predes_origin_impc) {
        if (!map[e.predes_origin_country]) map[e.predes_origin_country] = new Set();
        map[e.predes_origin_country].add(e.predes_origin_impc);
      }
      if (e.redes_dest_country && e.redes_dest_impc) {
        if (!map[e.redes_dest_country]) map[e.redes_dest_country] = new Set();
        map[e.redes_dest_country].add(e.redes_dest_impc);
      }
    }
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, Array.from(v)]));
  }, [allEvents]);
  useEffect(() => {
    // Use tracking_events date bounds when no date filter is active
    const dateFrom = dateRange.from || allDataBounds.min || undefined;
    const dateTo = dateRange.to || allDataBounds.max || undefined;
    const originImpcCodes = originCountry ? (countryToImpc[originCountry] || []) : undefined;
    const destImpcCodes = destCountry ? (countryToImpc[destCountry] || []) : undefined;
    fetchMatchedTagsCount(dateFrom, dateTo, originImpcCodes, destImpcCodes)
      .then(setMatchedTagsData)
      .catch(() => setMatchedTagsData(null));
  }, [dateRange.from, dateRange.to, originCountry, destCountry, countryToImpc, allDataBounds.min, allDataBounds.max]);

  /* RFID tab data — fetched directly from the RFID table (ETL-enriched) */
  const epcis = useEpcisData({
    dateFrom: dateRange.from || undefined,
    dateTo: dateRange.to || undefined,
    originCountry: originCountry || undefined,
    destCountry: destCountry || undefined,
  });

  /* Benchmark data — used for country dropdowns when Benchmark tab is active */
  const benchmarkMeta = useBenchmarkData({
    dateFrom: dateRange.from || undefined,
    dateTo: dateRange.to || undefined,
    originCountry: originCountry || undefined,
    destCountry: destCountry || undefined,
  });

  /* Date label for CSV filename */
  const dateLabel = useMemo(() => {
    if (!dateRange.from && !dateRange.to) return '';
    return [dateRange.from, dateRange.to].filter(Boolean).join('_to_');
  }, [dateRange]);

  /* Scatter data: departure lag vs arrival lead (FULL coverage only) */
  const scatterData = useMemo(() => {
    if (!events.length) return [];
    return events
      .filter(e => e.coverage_type === 'FULL' && e.departure_lag_hours !== null && e.arrival_lead_hours !== null)
      .map(e => ({ x: e.departure_lag_hours!, y: e.arrival_lead_hours!, s9id: e.s9id }))
      .slice(0, 800);
  }, [events]);

  /* ─── Loading ─── */
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 rounded-full mx-auto animate-spin" style={{ border: '3px solid #e2e8f0', borderTopColor: '#4F46E5' }} />
          <p className="text-sm text-slate-500 font-medium">Loading tracking data from Supabase…</p>
          <p className="text-xs text-slate-400">RFID · {new Date().toLocaleDateString('en-GB')}</p>
        </div>
      </div>
    );
  }

  /* ─── Error ─── */
  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-rose-200 rounded-lg p-6 max-w-md w-full text-center space-y-3">
          <div className="w-10 h-10 bg-rose-50 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-5 h-5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <p className="font-semibold text-rose-600">Connection Error</p>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  // stats from useTrackingData may be null when tracking_events has no rows for the
  // selected filter combination. This is fine — the active tabs (RFID, Benchmark) use
  // epcis data exclusively. Legacy tabs that use stats are guarded by activeTab checks.
  const safeStats = stats ?? {
    departurePairs: 0, departureAvgHours: 0, departureRfidBeforePct: 0, departureRfidBefore: 0,
    byOriginCountry: [], departureByCentre: [], departureCdf: [],
    arrivalPairs: 0, arrivalAvgHours: 0, arrivalRfidBeforePct: 0, arrivalRfidBefore: 0,
    byDestCountry: [], arrivalByCentre: [], arrivalCdf: [],
    transitPairs: 0, rfidTransitAvg: 0, ediTransitAvg: 0, transitDiffAvg: 0,
    rfidPureP25: 0, rfidPureP50: 0, rfidPureP75: 0, rfidPureRoutes: [],
    rfidDepartureTotal: 0, rfidDepartureByOriginCentre: [], rfidDepartureByOriginCountry: [], rfidDepartureCdf: [],
    rfidArrivalTotal: 0, rfidArrivalByDestCentre: [], rfidArrivalByDestCountry: [], rfidArrivalCdf: [],
    byRoute: [],
    transitRoutes: [], rfidTransitCdf: [], ediTransitCdf: [],
    coverageBreakdown: [],
  };

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ─── Header ─── */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="container">
          {/* Top row: logo + tabs */}
          <div className="flex items-center justify-between h-20 gap-4">
            {/* EDGE logo */}
            <div className="flex items-center gap-3 flex-shrink-0">
              <img
                src={EDGE_LOGO}
                alt="EDGE by GMS"
                className="h-16 w-auto object-contain"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="hidden lg:block border-l border-slate-200 pl-3">
                <p className="text-base font-bold text-slate-900 leading-tight tracking-tight">LEG2 Analysis Tool</p>
                <p className="text-[10px] text-slate-400 leading-tight">
                  {effectiveDateRange.from && effectiveDateRange.to
                    ? `${effectiveDateRange.from} – ${effectiveDateRange.to}`
                    : 'Jan 2026 – Mar 2026'} · <span className="mono-value">{epcis.journeys.length.toLocaleString()}</span>
                  {epcis.journeys.length !== epcis.stats.uniqueReceptacles && (
                    <span className="text-indigo-500"> / {epcis.stats.uniqueReceptacles.toLocaleString()}</span>
                  )} receptacles
                </p>
              </div>
            </div>

            {/* Nav tabs — desktop */}
            <nav className="hidden md:flex items-end gap-4">
              {/* RFID tab group */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-[11px] font-bold uppercase tracking-widest text-indigo-400 px-1">RFID</span>
                <div className="flex items-center gap-1">
                  {['RFID'].map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-5 py-2 text-sm font-semibold rounded-lg transition-all duration-150 ${
                        activeTab === tab
                          ? 'bg-indigo-600 text-white shadow-md'
                          : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>
              {/* Divider */}
              <div className="w-px h-10 bg-slate-200 self-center" />
              {/* EDI / RFID Benchmark group */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-[11px] font-bold uppercase tracking-widest text-amber-500 px-1">EDI / RFID Benchmark</span>
                <div className="flex items-center gap-1">
                  {['Benchmark'].map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-5 py-2 text-sm font-semibold rounded-lg transition-all duration-150 ${
                        activeTab === tab
                          ? 'bg-amber-500 text-white shadow-md'
                          : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>
            </nav>

            {/* User menu */}
            <UserMenu />

            {/* Mobile tab select */}
            <select
              className="md:hidden text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white"
              value={activeTab}
              onChange={e => setActiveTab(e.target.value)}
            >
              {TABS.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>

          {/* Global filters row: dates + origin + destination */}
          <div className="border-t border-slate-100 py-2">
            <GlobalFilters
              dateRange={dateRange}
              onDateChange={setDateRange}
              minDate={allDataBounds.min}
              maxDate={allDataBounds.max}
              originCountry={originCountry}
              onOriginChange={setOriginCountry}
              destCountry={destCountry}
              onDestChange={setDestCountry}
              allOriginCountries={activeTab === 'Benchmark' ? benchmarkMeta.allOriginCountries : epcis.allOriginCountries}
              allDestCountries={activeTab === 'Benchmark' ? benchmarkMeta.allDestCountries : epcis.allDestCountries}
              filteredCount={activeTab === 'Benchmark' ? benchmarkMeta.rows.length : epcis.journeys.length}
              totalCount={activeTab === 'Benchmark' ? benchmarkMeta.rows.length : epcis.stats.uniqueReceptacles}
            />
          </div>
        </div>
      </header>

      {/* ─── Main content ─── */}
      <main className="container py-6 space-y-7">

        {/* Active filter banner */}
        <FilterBanner
          from={dateRange.from}
          to={dateRange.to}
          originCountry={originCountry}
          destCountry={destCountry}
          count={activeTab === 'Benchmark' ? benchmarkMeta.rows.length : epcis.journeys.length}
          total={activeTab === 'Benchmark' ? benchmarkMeta.rows.length : epcis.stats.uniqueReceptacles}
        />

        {/* ════════════════════ BENCHMARK ════════════════════ */}
        {activeTab === 'Benchmark' && (
          <Section
            title="RFID vs EDI Benchmark"
            subtitle="Direct comparison between RFID physical readings and EDI declared events — only receptacles with a pair in both RFID and datos EDI via ID Relation"
          >
            <BenchmarkPanel filters={{
              dateFrom: dateRange.from || undefined,
              dateTo: dateRange.to || undefined,
              originCountry: originCountry || undefined,
              destCountry: destCountry || undefined,
            }} />
          </Section>
        )}
        {/* ════════════════════ DEPARTURE (legacy — hidden) ════════════════════ */}
        {activeTab === 'Departure_legacy' && (
          <Section
            title="Departure Event: RFID vs PREDES"
            subtitle="Comparison of the first RFID reading at the origin centre against the PREDES (pre-advice of dispatch) EDI message. Positive values = RFID detected AFTER PREDES."
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard title="Analysed Pairs" value={safeStats.departurePairs.toLocaleString()} subtitle="RFID + PREDES matches" badge={{ label: 'departure', color: 'blue' }}
                tooltip="Number of receptacles that have both an RFID reading at the origin centre AND a PREDES message. Only these pairs can be used to calculate the departure lag (time difference between administrative dispatch and physical detection)."
              />
              <KpiCard title="Avg Lag" value={`+${safeStats.departureAvgHours}h / ${(safeStats.departureAvgHours / 24).toFixed(1)}d`} subtitle="RFID after PREDES" badge={{ label: 'RFID after PREDES', color: 'amber' }}
                tooltip="The median (50th percentile) time between the PREDES message and the first RFID reading at the origin centre. The median is used instead of the mean to reduce the influence of extreme outliers. A positive value is expected and operationally normal."
              />

              <KpiCard title="RFID Before PREDES" value={`${safeStats.departureRfidBeforePct}%`} subtitle={`${safeStats.departureRfidBefore} anomalous cases`}
                badge={{ label: safeStats.departureRfidBeforePct < 10 ? 'Normal' : 'Review', color: safeStats.departureRfidBeforePct < 10 ? 'green' : 'red' }}
                tooltip="Percentage of cases where the RFID reading at origin occurred BEFORE the PREDES message was issued. This is technically anomalous (PREDES should precede physical departure). Causes: EDI transmission delays, timestamp errors, or pre-loading of receptacles before administrative processing."
              />
            </div>

            {/* ── By Origin Country ── */}
            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard title="Departure Lag by Origin Country" subtitle="Avg hours between PREDES and first RFID reading" tooltip="Each bar shows the avg departure lag per origin country. Amber (positive) = RFID detected after PREDES (normal). Green (negative) = RFID detected before PREDES (anomalous). Reference line at 0h separates both cases.">
                <ResponsiveContainer width="100%" height={Math.max(220, safeStats.byOriginCountry.length * 34)}>
                  <BarChart data={safeStats.byOriginCountry} layout="vertical" margin={{ left: 0, right: 60, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="country" tick={{ fontSize: 11 }} width={110} />
                    <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="4 2"
                      label={{ value: '← RFID before PREDES  |  RFID after PREDES →', position: 'top', style: { fontSize: 9, fill: '#94a3b8' } }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="avgDepartureLag" name="Avg lag (hours)" radius={[0, 3, 3, 0]}>
                      {safeStats.byOriginCountry.map((entry, i) => <Cell key={i} fill={entry.avgDepartureLag < 0 ? C.emerald : C.amber} />)}
                      <LabelList dataKey="avgDepartureLag" position="right" formatter={(v: number) => `${v.toFixed(0)}h / ${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Receptacles by Origin Country" subtitle="Volume of departure pairs per country" tooltip="Number of receptacles with RFID+PREDES pairs per origin country.">
                <ResponsiveContainer width="100%" height={Math.max(220, safeStats.byOriginCountry.length * 34)}>
                  <BarChart data={safeStats.byOriginCountry} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="country" tick={{ fontSize: 11 }} width={110} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name="Receptacles" fill={C.indigo} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="count" position="right" style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* ── By Origin Centre ── */}
            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard title="Departure Lag by Origin Centre" subtitle="Avg hours between PREDES and first RFID reading" tooltip="Each bar shows the avg departure lag for receptacles processed at that origin centre. Centres with longer positive bars have larger gaps between administrative preparation (PREDES) and physical RFID detection. Negative bars indicate centres where RFID typically precedes PREDES.">
                <ResponsiveContainer width="100%" height={Math.max(220, safeStats.departureByCentre.length * 34)}>
                  <BarChart data={safeStats.departureByCentre} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={140} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="avg" name="Avg lag (hours)" fill={C.indigo} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="avg" position="right" formatter={(v: number) => `${v.toFixed(0)}h / ${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="RFID Before PREDES Rate by Centre" subtitle="% of cases where RFID was detected before PREDES was issued" tooltip="Red bars show the percentage of receptacles at each centre where RFID was detected before the PREDES message. High rates at specific centres may indicate: (1) EDI message transmission delays at that origin postal operator, (2) systematic timestamp issues, or (3) early physical processing before administrative dispatch.">
                <ResponsiveContainer width="100%" height={Math.max(220, safeStats.departureByCentre.length * 34)}>
                  <BarChart data={safeStats.departureByCentre} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                    <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={140} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="rfidBeforePct" name="RFID before PREDES (%)" fill={C.rose} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="rfidBeforePct" position="right" formatter={(v: number) => `${v}%`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {safeStats.departureCdf.length > 0 && (
              <ChartCard
                title="Cumulative Frequency: Departure Lag"
                subtitle={`Distribution of ${safeStats.departurePairs.toLocaleString()} departure lag values (hours)`}
                tooltip="Cumulative distribution function (CDF) of departure lag. The Y axis shows the percentage of receptacles with a lag ≤ X hours. The steeper the curve, the more concentrated the distribution. The vertical reference line marks 0h (RFID = PREDES). Read: 'X% of receptacles have a departure lag ≤ Y hours'."
              >
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={safeStats.departureCdf} margin={{ left: 10, right: 20, top: 10, bottom: 20 }}>
                    <defs>
                      <linearGradient id="cdfDepGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.indigo} stopOpacity={0.18} />
                        <stop offset="95%" stopColor={C.indigo} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="x" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`}
                      label={{ value: 'Departure lag (h)', position: 'insideBottom', offset: -10, style: { fontSize: 10, fill: '#94a3b8' } }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]}
                      label={{ value: 'Cumulative %', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }} />
                    <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="4 2" label={{ value: '0h', position: 'top', style: { fontSize: 9, fill: '#94a3b8' } }} />
                    <ReferenceLine y={50} stroke={C.indigo} strokeDasharray="4 2" strokeOpacity={0.4} label={{ value: 'P50', position: 'right', style: { fontSize: 9, fill: C.indigo } }} />
                    <Tooltip formatter={(v: any) => [`${v}%`, 'Cumulative']} labelFormatter={l => `Lag ≤ ${l}h`} />
                    <Area type="monotone" dataKey="pct" stroke={C.indigo} strokeWidth={2} fill="url(#cdfDepGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            <InfoBox color="indigo">
              <span className="font-semibold">Interpretation:</span> The PREDES message is issued by the origin postal operator when the dispatch is administratively prepared, typically 2–3 days before the receptacle physically departs. The avg lag of <strong>+{safeStats.departureAvgHours}h ({(safeStats.departureAvgHours/24).toFixed(1)}d)</strong> is operationally consistent with this workflow. Cases where RFID precedes PREDES ({safeStats.departureRfidBeforePct}%) may indicate EDI transmission delays or timestamp inconsistencies.
            </InfoBox>

            <DepartureAnalysis s={stats} />

          </Section>
        )}

        {/* ════════════════════ ARRIVAL ════════════════════ */}
        {activeTab === 'Arrival_legacy' && (
          <Section
            title="Arrival Event: RFID vs RESDES"
            subtitle="Comparison of the last RFID reading at the destination centre against the RESDES (advice of receipt) EDI message. Negative values = RFID detected BEFORE RESDES (real-time advantage)."
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard title="Analysed Pairs" value={safeStats.arrivalPairs.toLocaleString()} subtitle="RFID + RESDES matches" badge={{ label: 'arrival', color: 'green' }}
                tooltip="Number of receptacles with both an RFID reading at the destination centre AND a RESDES message. Only these pairs enable the arrival lead/lag calculation."
              />
              <KpiCard title="Avg Lead/Lag"
                value={`${safeStats.arrivalAvgHours < 0 ? '' : '+'}${safeStats.arrivalAvgHours.toFixed(1)}h / ${(Math.abs(safeStats.arrivalAvgHours)/24).toFixed(1)}d`}
                subtitle={safeStats.arrivalAvgHours < 0 ? `RFID before RESDES` : `RFID after RESDES`}
                badge={{ label: safeStats.arrivalAvgHours < 0 ? 'RFID advantage' : 'EDI faster', color: safeStats.arrivalAvgHours < 0 ? 'green' : 'amber' }}
                tooltip="Median time between the last RFID reading at the destination and the RESDES message. Negative = RFID detected BEFORE RESDES (RFID provides earlier visibility). Positive = RESDES issued before RFID detection (EDI is faster at this destination)."
              />
              <KpiCard title="RFID Before RESDES" value={`${safeStats.arrivalRfidBeforePct}%`} subtitle={`${safeStats.arrivalRfidBefore} cases`} badge={{ label: 'real-time visibility', color: 'green' }}
                tooltip="Percentage of arrivals where RFID detected the receptacle BEFORE the RESDES message was generated. This directly measures the real-time visibility advantage of RFID: the higher this percentage, the more value RFID adds over EDI at the destination."
              />
              <KpiCard title="RFID After RESDES" value={`${100 - safeStats.arrivalRfidBeforePct}%`} subtitle="EDI faster than RFID" badge={{ label: 'review', color: 'amber' }}
                tooltip="Percentage of arrivals where the RESDES message was issued BEFORE the RFID reading. In these cases EDI provides earlier visibility than RFID. May indicate: late RFID scanning at the destination, or very fast EDI processing at certain destination operators."
              />
            </div>

            {/* ── By Destination Country ── */}
            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard title="Arrival Lead/Lag by Destination Country" subtitle="Avg hours (negative = RFID before RESDES)" tooltip="Each bar shows the avg arrival lead/lag per destination country. Green (negative) = RFID detected before RESDES — real-time advantage. Amber (positive) = RESDES issued before RFID. Reference line at 0h separates both cases.">
                <ResponsiveContainer width="100%" height={Math.max(220, safeStats.byDestCountry.length * 34)}>
                  <BarChart data={safeStats.byDestCountry} layout="vertical" margin={{ left: 0, right: 60, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="country" tick={{ fontSize: 11 }} width={110} />
                    <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="4 2"
                      label={{ value: '← RFID before RESDES  |  RFID after RESDES →', position: 'top', style: { fontSize: 9, fill: '#94a3b8' } }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="avgArrivalLead" name="Avg lead/lag (hours)" radius={[0, 3, 3, 0]}>
                      {safeStats.byDestCountry.map((entry, i) => <Cell key={i} fill={entry.avgArrivalLead < 0 ? C.emerald : C.amber} />)}
                      <LabelList dataKey="avgArrivalLead" position="right" formatter={(v: number) => `${v.toFixed(0)}h / ${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Receptacles by Destination Country" subtitle="Volume of arrival pairs per country" tooltip="Number of receptacles with RFID+RESDES pairs per destination country.">
                <ResponsiveContainer width="100%" height={Math.max(220, safeStats.byDestCountry.length * 34)}>
                  <BarChart data={safeStats.byDestCountry} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="country" tick={{ fontSize: 11 }} width={110} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name="Receptacles" fill={C.emerald} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="count" position="right" style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* ── By Destination Centre ── */}
            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard title="Arrival Lead/Lag by Destination Centre" subtitle="Avg hours (negative = RFID before RESDES)" tooltip="Each bar shows the avg arrival lead/lag per destination centre. Green bars (negative values) = RFID detected before RESDES — RFID provides real-time advantage. Amber bars (positive values) = RESDES issued before RFID detection. The reference line at 0 separates the two cases.">
                <ResponsiveContainer width="100%" height={Math.max(220, safeStats.arrivalByCentre.length * 34)}>
                  <BarChart data={safeStats.arrivalByCentre} layout="vertical" margin={{ left: 0, right: 55, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={145} />
                    <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="4 2" />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="avg" name="Avg lead/lag (hours)" radius={[0, 3, 3, 0]}>
                      {safeStats.arrivalByCentre.map((entry, i) => <Cell key={i} fill={entry.avg < 0 ? C.emerald : C.amber} />)}
                      <LabelList dataKey="avg" position="right" formatter={(v: number) => `${v.toFixed(0)}h/${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="RFID Before RESDES Rate by Destination" subtitle="% of arrivals where RFID detected before RESDES" tooltip="Green bars show the percentage of arrivals at each destination centre where RFID was detected before RESDES. A high rate (close to 100%) means RFID consistently provides earlier visibility than EDI at that destination. A low rate means EDI is typically faster at that centre.">
                <ResponsiveContainer width="100%" height={Math.max(220, safeStats.arrivalByCentre.length * 34)}>
                  <BarChart data={safeStats.arrivalByCentre} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                    <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={145} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="rfidBeforePct" name="RFID before RESDES (%)" fill={C.emerald} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="rfidBeforePct" position="right" formatter={(v: number) => `${v}%`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {safeStats.arrivalCdf.length > 0 && (
              <ChartCard
                title="Cumulative Frequency: Arrival Lead/Lag"
                subtitle={`Distribution of ${safeStats.arrivalPairs.toLocaleString()} arrival lead/lag values (hours)`}
                tooltip="Cumulative distribution function (CDF) of arrival lead/lag. Negative values = RFID detected before RESDES (RFID advantage). The Y axis shows the percentage of receptacles with a lead/lag ≤ X hours. The vertical reference line at 0h separates RFID-before (left) from RFID-after (right) cases."
              >
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={safeStats.arrivalCdf} margin={{ left: 10, right: 20, top: 10, bottom: 20 }}>
                    <defs>
                      <linearGradient id="cdfArrGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.emerald} stopOpacity={0.18} />
                        <stop offset="95%" stopColor={C.emerald} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="x" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`}
                      label={{ value: 'Arrival lead/lag (h)', position: 'insideBottom', offset: -10, style: { fontSize: 10, fill: '#94a3b8' } }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]}
                      label={{ value: 'Cumulative %', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }} />
                    <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="4 2" label={{ value: '0h', position: 'top', style: { fontSize: 9, fill: '#94a3b8' } }} />
                    <ReferenceLine y={50} stroke={C.emerald} strokeDasharray="4 2" strokeOpacity={0.4} label={{ value: 'P50', position: 'right', style: { fontSize: 9, fill: C.emerald } }} />
                    <Tooltip formatter={(v: any) => [`${v}%`, 'Cumulative']} labelFormatter={l => `Lead/lag ≤ ${l}h`} />
                    <Area type="monotone" dataKey="pct" stroke={C.emerald} strokeWidth={2} fill="url(#cdfArrGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            <InfoBox color="emerald">
              <span className="font-semibold">Key Finding:</span> In <strong>{safeStats.arrivalRfidBeforePct}%</strong> of arrival events, the RFID system detects the receptacle <em>before</em> the RESDES message is generated. This represents the measurable real-time visibility advantage of RFID over EDI at the destination centre — the avg lead time is <strong>{Math.abs(safeStats.arrivalAvgHours).toFixed(1)}h ({(Math.abs(safeStats.arrivalAvgHours)/24).toFixed(1)}d)</strong>.
            </InfoBox>

            <ArrivalAnalysis s={stats} />

          </Section>
        )}

        {/* ════════════════════ TRANSIT ════════════════════ */}
        {activeTab === 'Transit_legacy' && (
          <Section
            title="Transit Time Comparison"
            subtitle="For receptacles with RFID readings at both origin and destination centres: physical transit (RFID) vs declared transit (EDI: RESDES − PREDES)."
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard title="Validated Routes" value={safeStats.transitPairs.toLocaleString()} subtitle="Full origin→dest RFID" badge={{ label: 'end-to-end', color: 'blue' }}
                tooltip="Number of receptacles with RFID readings at both a distinct origin and destination centre (full_route_validated = true). Only these enable a direct comparison between physical transit time (RFID) and declared transit time (EDI)."
              />
              <KpiCard title="Avg RFID Transit" value={`${safeStats.rfidTransitAvg}h / ${(safeStats.rfidTransitAvg / 24).toFixed(1)}d`} subtitle="Avg physical transit (RFID)" badge={{ label: 'physical', color: 'blue' }}
                tooltip="Median physical transit time measured by RFID: the time between the last RFID reading at the origin centre and the first RFID reading at the destination centre. This is the actual time the receptacle spent in transit, as measured by the RFID infrastructure."
              />
              <KpiCard title="Avg EDI Transit" value={`${safeStats.ediTransitAvg}h / ${(safeStats.ediTransitAvg / 24).toFixed(1)}d`} subtitle="Avg declared transit (EDI)" badge={{ label: 'declared', color: 'slate' }}
                tooltip="Median declared transit time from EDI messages: RESDES timestamp minus PREDES timestamp. This is the administratively declared transit time, which may differ from the physical transit measured by RFID due to processing delays, pre-advice timing, or timestamp inconsistencies."
              />
              <KpiCard title="EDI Overestimate" value={`${safeStats.transitDiffAvg > 0 ? '+' : ''}${safeStats.transitDiffAvg}h / ${(Math.abs(safeStats.transitDiffAvg)/24).toFixed(1)}d`} subtitle="EDI vs RFID transit gap"
                badge={{ label: safeStats.transitDiffAvg > 0 ? 'EDI longer' : 'RFID longer', color: safeStats.transitDiffAvg > 0 ? 'amber' : 'green' }}
                tooltip="Median difference between EDI-declared transit and RFID-measured physical transit (EDI minus RFID). Positive = EDI overestimates transit time (EDI says the journey took longer than RFID measured). Negative = EDI underestimates. This gap reveals systematic biases in administrative declarations."
              />
            </div>

            {safeStats.transitRoutes.length > 0 ? (
              <ChartCard title="Transit Comparison by Route" subtitle="RFID physical transit vs EDI declared transit (avg hours)" tooltip="Grouped bar chart comparing RFID-measured physical transit (indigo) vs EDI-declared transit (grey) for each origin→destination route. Routes where the grey bar is longer than the indigo bar indicate EDI overestimates transit. Routes where indigo is longer indicate EDI underestimates. The difference quantifies the accuracy of EDI declarations.">
                <ResponsiveContainer width="100%" height={Math.max(200, safeStats.transitRoutes.length * 60)}>
                  <BarChart data={safeStats.transitRoutes} layout="vertical" margin={{ left: 0, right: 65, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="route" tick={{ fontSize: 10 }} width={185} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                    <Bar dataKey="rfidAvg" name="RFID Physical (h)" fill={C.indigo} radius={[0, 2, 2, 0]} barSize={13}>
                      <LabelList dataKey="rfidAvg" position="right" formatter={(v: number) => `${v.toFixed(0)}h/${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: C.indigo }} />
                    </Bar>
                    <Bar dataKey="ediAvg" name="EDI Declared (h)" fill={C.slate} radius={[0, 2, 2, 0]} barSize={13}>
                      <LabelList dataKey="ediAvg" position="right" formatter={(v: number) => `${v.toFixed(0)}h/${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: C.slate }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-5">
                <p className="font-semibold text-amber-800 text-sm mb-1">Limited transit data</p>
                <p className="text-xs text-amber-700 leading-relaxed">
                  End-to-end transit measurement requires RFID coverage at both origin and destination. Only {safeStats.transitPairs} fully validated routes were found in the selected date range.
                </p>
              </div>
            )}

            {(safeStats.rfidTransitCdf.length > 0 || safeStats.ediTransitCdf.length > 0) && (
              <ChartCard
                title="Cumulative Frequency: Transit Times"
                subtitle={`Distribution of ${safeStats.transitPairs.toLocaleString()} transit time values — RFID physical vs EDI declared`}
                tooltip="Cumulative distribution function (CDF) comparing RFID-measured physical transit (indigo) vs EDI-declared transit (grey). A curve shifted to the left means shorter transit times. Where the indigo curve is to the left of the grey curve, RFID measures shorter transit than EDI declares. The gap between curves at any percentile quantifies the systematic over/underestimation of EDI."
              >
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart margin={{ left: 10, right: 20, top: 10, bottom: 20 }}>
                    <defs>
                      <linearGradient id="cdfRfidGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.indigo} stopOpacity={0.12} />
                        <stop offset="95%" stopColor={C.indigo} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="x" type="number" allowDuplicatedCategory={false} tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`}
                      label={{ value: 'Transit time (h)', position: 'insideBottom', offset: -10, style: { fontSize: 10, fill: '#94a3b8' } }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]}
                      label={{ value: 'Cumulative %', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }} />
                    <ReferenceLine y={50} strokeDasharray="4 2" strokeOpacity={0.35} stroke="#94a3b8" label={{ value: 'P50', position: 'right', style: { fontSize: 9, fill: '#94a3b8' } }} />
                    <Tooltip formatter={(v: any, name: string) => [`${v}%`, name]} labelFormatter={l => `Transit ≤ ${l}h`} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Line data={safeStats.rfidTransitCdf} type="monotone" dataKey="pct" name="RFID Physical" stroke={C.indigo} strokeWidth={2} dot={false} />
                    <Line data={safeStats.ediTransitCdf} type="monotone" dataKey="pct" name="EDI Declared" stroke={C.slate} strokeWidth={2} dot={false} strokeDasharray="5 3" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            <InfoBox color="indigo">
              <span className="font-semibold">Methodology:</span> Physical transit time is measured as the difference between the last RFID reading at the origin centre and the first RFID reading at the destination centre (different centres only, intermediate stops excluded). EDI transit is RESDES timestamp minus PREDES timestamp. Only routes with <span className="mono-value bg-white/60 px-1 rounded">full_route_validated = true</span> are included.
            </InfoBox>

            <TransitAnalysis s={stats} />

          </Section>
        )}

        {/* ════════════════════ RFID (PURE EPCIS) ════════════════════ */}
        {activeTab === 'RFID' && (
          <>
          <Section title="Search ID" subtitle="Look up any Tag ID or Receptacle ID to see its full journey — RFID readings and EDI messages ordered by timestamp">
            <SearchID />
          </Section>
          <Section
            title="RFID Analysis"
            subtitle={`RFID data — ${epcis.stats.uniqueReceptacles.toLocaleString()} unique tag IDs · RFID Outbound: ${(epcis.rfidCounts?.rfPredes ?? '…').toLocaleString()} · RFID Inbound: ${(epcis.rfidCounts?.rfResdes ?? '…').toLocaleString()} · E2E: ${(epcis.rfidCounts?.rfE2e ?? '…').toLocaleString()}${epcis.backgroundLoading ? ' · loading historical data…' : ''}`}
          >
            {epcis.loading && (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid #e2e8f0', borderTopColor: '#4F46E5' }} />
                <span className="ml-3 text-sm text-slate-500">Loading last 30 days…</span>
              </div>
            )}
            {epcis.backgroundLoading && !epcis.loading && (
              <div className="flex items-center gap-2 px-4 py-2 mb-4 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-600">
                <div className="w-3 h-3 rounded-full animate-spin flex-shrink-0" style={{ border: '2px solid #c7d2fe', borderTopColor: '#4F46E5' }} />
                <span>Loading historical data in background — statistics will update when complete</span>
              </div>
            )}
            {!epcis.loading && (
              <>
                {/* ── OVERVIEW ── */}
                <div className="mb-2">
                  <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3">Overview</h3>
                  {/* Progressive loading banner for KPI counts */}
                  {epcis.rfidCountsLoading && (
                    <div className="flex items-center gap-2 px-3 py-1.5 mb-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700">
                      <div className="w-3 h-3 rounded-full animate-spin flex-shrink-0" style={{ border: '2px solid #fde68a', borderTopColor: '#F59E0B' }} />
                      <span>Showing last 30 days — loading full history…</span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 md:grid-cols-7 gap-4 mb-5">
                    <KpiCard
                      title="Matched Tags"
                      value={matchedTagsData != null ? matchedTagsData.count.toLocaleString() : '—'}
                      subtitle={matchedTagsData?.minDate && matchedTagsData?.maxDate
                        ? `${matchedTagsData.minDate} → ${matchedTagsData.maxDate}`
                        : 'records in ID Relation table'}
                      badge={{ label: 'id-match', color: 'blue' }}
                      tooltip="Total records in the ID Relation table for the selected date and country filters. Represents receptacles for which a tag ID ↔ s9id mapping exists."
                    />
                    <KpiCard
                      title="Total ID Receptacles"
                      value={epcis.rfidCounts != null ? epcis.rfidCounts.totalTags.toLocaleString() : '…'}
                      subtitle={epcis.rfidCountsLoading ? 'last 30 days — loading…' : 'unique tag IDs in RFID table'}
                      badge={{ label: 'rfid', color: 'blue' }}
                      tooltip="Total unique tag IDs in the RFID table for the selected date and country filters. Shows last 30 days immediately, then updates with full history."
                    />
                    <KpiCard
                      title="RFID Departures"
                      value={epcis.rfidCounts != null ? epcis.rfidCounts.rfidDepartures.toLocaleString() : '…'}
                      subtitle={epcis.rfidCountsLoading ? 'last 30 days — loading…' : 'unique tag IDs with ORIGIN event'}
                      badge={{ label: 'origin', color: 'blue' }}
                      tooltip="Unique tag IDs with event_type = ORIGIN: first reading at the dispatch centre (intra-country). Represents receptacles identified at the sending centre before international dispatch."
                    />
                    <KpiCard
                      title="RFID Outbound"
                      value={epcis.rfidCounts != null ? epcis.rfidCounts.rfPredes.toLocaleString() : '…'}
                      subtitle={epcis.rfidCountsLoading ? 'last 30 days — loading…' : 'unique tag IDs with DEPARTURE event'}
                      badge={{ label: 'departure', color: 'indigo' }}
                      tooltip="Unique tag IDs with event_type = DEPARTURE: last RFID reading before crossing an international border. RFID Outbound is the physical equivalent of the EDI PREDES message."
                    />
                    <KpiCard
                      title="RF E2E"
                      value={epcis.rfidCounts != null ? epcis.rfidCounts.rfE2e.toLocaleString() : '…'}
                      subtitle={epcis.rfidCountsLoading ? 'last 30 days — loading…' : 'tag IDs with RFID Outbound and RFID Inbound'}
                      badge={{ label: 'e2e', color: 'amber' }}
                      tooltip="Unique tag IDs with both a DEPARTURE event (RFID Outbound) and an ARRIVAL event (RFID Inbound). These are the receptacles for which a complete international RFID transit can be measured and compared against EDI."
                    />
                    <KpiCard
                      title="RFID Inbound"
                      value={epcis.rfidCounts != null ? epcis.rfidCounts.rfResdes.toLocaleString() : '…'}
                      subtitle={epcis.rfidCountsLoading ? 'last 30 days — loading…' : 'unique tag IDs with ARRIVAL event'}
                      badge={{ label: 'arrival', color: 'green' }}
                      tooltip="Unique tag IDs with event_type = ARRIVAL: first RFID reading after crossing an international border. RFID Inbound is the physical equivalent of the EDI RESDES message."
                    />
                    <KpiCard
                      title="RFID Arrivals"
                      value={epcis.rfidCounts != null ? epcis.rfidCounts.rfidArrivals.toLocaleString() : '…'}
                      subtitle={epcis.rfidCountsLoading ? 'last 30 days — loading…' : 'unique tag IDs with DESTINATION event'}
                      badge={{ label: 'dest', color: 'teal' }}
                      tooltip="Unique tag IDs with event_type = DESTINATION: last reading at the delivery centre (intra-country). Represents receptacles identified at the receiving centre after international arrival."
                    />
                  </div>

                </div>

                {/* ── DEPARTURES + ARRIVALS in parallel columns ── */}
                <div className="mt-6 grid md:grid-cols-2 gap-8">

                {/* ── LEFT: DEPARTURES ── */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">Departures</h3>

                  {/* KPIs */}
                  <div className="grid grid-cols-2 gap-4 mb-5">
                    <KpiCard
                      title="Total RFID Departures"
                      value={epcis.stats.withOriginReading.toLocaleString()}
                      subtitle="receptacles with RFID reading at origin centre"
                      badge={{ label: 'departures', color: 'blue' }}
                      tooltip="Receptacles with rfid_origin_impc set from RFID table (BOTH + ORIGIN_ONLY cases)."
                    />
                    <KpiCard
                      title="Origin Countries"
                      value={epcis.stats.uniqueOrigins.toLocaleString()}
                      subtitle="distinct origin countries"
                      badge={{ label: 'countries', color: 'blue' }}
                      tooltip="Number of distinct rfid_origin_country values from RFID table."
                    />
                    <KpiCard
                      title="Origin Centres"
                      value={epcis.stats.byOriginCentre.length.toLocaleString()}
                      subtitle="distinct origin postal centres"
                      badge={{ label: 'centres', color: 'blue' }}
                      tooltip="Number of distinct rfid_origin_centre values from RFID table."
                    />
                    <KpiCard
                      title="Avg RFID Transit"
                      value={epcis.stats.avgTransitHours != null ? `${epcis.stats.avgTransitHours}h` : '—'}
                      subtitle="avg rfid_transit_hours (e2e pairs)"
                      badge={{ label: 'transit', color: 'amber' }}
                      tooltip="Median rfid_transit_hours from RFID table for end-to-end pairs."
                    />
                  </div>

                  {/* By country */}
                  <ChartCard
                    title="Departures by Origin Country"
                    subtitle="All RFID receptacles by origin country"
                    tooltip="Number of receptacles with an RFID origin reading, grouped by origin country."
                  >
                    <ResponsiveContainer width="100%" height={Math.max(220, epcis.stats.byOriginCountry.length * 34)}>
                      <BarChart data={epcis.stats.byOriginCountry} layout="vertical" margin={{ left: 8, right: 50, top: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                        <YAxis type="category" dataKey="country" tick={{ fontSize: 10, fill: '#64748b' }} width={110} interval={0} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="count" name="Receptacles" fill={C.indigo} radius={[0, 3, 3, 0]}>
                          <LabelList dataKey="count" position="right" style={{ fontSize: 10, fill: '#64748b' }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>

                  {/* By centre */}
                  <div className="mt-4 grid grid-cols-1 gap-4">
                    <ChartCard
                      title="Departure Volume by Origin Centre"
                      subtitle="Receptacles with RFID last scan at origin centre"
                      tooltip="Number of receptacles with a valid RFID departure reading at each origin postal centre. Sorted by volume."
                    >
                      <ResponsiveContainer width="100%" height={Math.max(220, epcis.stats.byOriginCentre.length * 34)}>
                        <BarChart data={epcis.stats.byOriginCentre.map(x => ({ centre: x.centre, n: x.count }))} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 10 }} />
                          <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={140} interval={0} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="n" name="Receptacles" fill={C.indigo} radius={[0, 3, 3, 0]}>
                            <LabelList dataKey="n" position="right" style={{ fontSize: 10, fill: '#64748b' }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartCard>

                  </div>
                </div>

                {/* ── RIGHT: ARRIVALS ── */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">Arrivals</h3>

                  {/* KPIs */}
                  <div className="grid grid-cols-2 gap-4 mb-5">
                    <KpiCard
                      title="Total RFID Arrivals"
                      value={epcis.stats.withDestReading.toLocaleString()}
                      subtitle="receptacles with RFID reading at destination centre"
                      badge={{ label: 'arrivals', color: 'green' }}
                      tooltip="Receptacles with rfid_dest_impc set from RFID table (BOTH + DEST_ONLY cases)."
                    />
                    <KpiCard
                      title="Destination Countries"
                      value={epcis.stats.uniqueDestinations.toLocaleString()}
                      subtitle="distinct destination countries"
                      badge={{ label: 'countries', color: 'green' }}
                      tooltip="Number of distinct rfid_dest_country values from RFID table."
                    />
                    <KpiCard
                      title="Destination Centres"
                      value={epcis.stats.byDestCentre.length.toLocaleString()}
                      subtitle="distinct destination postal centres"
                      badge={{ label: 'centres', color: 'green' }}
                      tooltip="Number of distinct rfid_dest_centre values from RFID table."
                    />
                    <KpiCard
                      title="End-to-End Coverage"
                      value={`${epcis.stats.endToEndPct}%`}
                      subtitle={`${epcis.stats.endToEndPairs.toLocaleString()} of ${epcis.stats.uniqueReceptacles.toLocaleString()} receptacles`}
                      badge={{ label: 'e2e', color: 'amber' }}
                      tooltip="Percentage of RFID receptacles with rfid_dest_impc ≠ rfid_origin_impc from RFID table."
                    />
                  </div>

                  {/* By country */}
                  <ChartCard
                    title="Arrivals by Destination Country"
                    subtitle="End-to-end RFID pairs by destination country"
                    tooltip="Number of receptacles with RFID readings at both origin and destination, grouped by destination country."
                  >
                    <ResponsiveContainer width="100%" height={Math.max(220, epcis.stats.byDestCountry.length * 34)}>
                      <BarChart data={epcis.stats.byDestCountry} layout="vertical" margin={{ left: 8, right: 50, top: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                        <YAxis type="category" dataKey="country" tick={{ fontSize: 10, fill: '#64748b' }} width={110} interval={0} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="count" name="Receptacles" fill={C.emerald} radius={[0, 3, 3, 0]}>
                          <LabelList dataKey="count" position="right" style={{ fontSize: 10, fill: '#64748b' }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>

                  {/* By centre */}
                  <div className="mt-4 grid grid-cols-1 gap-4">
                    <ChartCard
                      title="Arrival Volume by Destination Centre"
                      subtitle="Receptacles with RFID first scan at destination centre"
                      tooltip="Number of receptacles with a valid RFID arrival reading at each destination postal centre. Sorted by volume."
                    >
                      <ResponsiveContainer width="100%" height={Math.max(220, epcis.stats.byDestCentre.length * 34)}>
                        <BarChart data={epcis.stats.byDestCentre.map(x => ({ centre: x.centre, n: x.count }))} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 10 }} />
                          <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={145} interval={0} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="n" name="Receptacles" fill={C.emerald} radius={[0, 3, 3, 0]}>
                            <LabelList dataKey="n" position="right" style={{ fontSize: 10, fill: '#64748b' }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartCard>

                  </div>
                </div>
                </div>{/* end parallel grid */}

                {/* ── TRANSIT ── */}
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3">Transit</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                    <KpiCard
                      title="End-to-End Pairs"
                      value={epcis.stats.endToEndPairs.toLocaleString()}
                      subtitle="Full origin→dest RFID"
                      badge={{ label: 'end-to-end', color: 'blue' }}
                      tooltip="Receptacles with rfid_dest_impc ≠ rfid_origin_impc from RFID table."
                    />
                    <KpiCard
                      title="Avg RFID Transit"
                      value={epcis.stats.avgTransitHours != null ? `${epcis.stats.avgTransitHours}h / ${(epcis.stats.avgTransitHours / 24).toFixed(1)}d` : '—'}
                      subtitle="rfid_origin_time → rfid_dest_time"
                      badge={{ label: 'avg', color: 'blue' }}
                      tooltip="Median rfid_transit_hours from RFID table for end-to-end pairs."
                    />
                    <KpiCard
                      title="IQR Range"
                      value={epcis.stats.p25TransitHours != null ? `${epcis.stats.p25TransitHours}h – ${epcis.stats.p75TransitHours}h` : '—'}
                      subtitle={epcis.stats.p25TransitHours != null ? `${(epcis.stats.p25TransitHours!/24).toFixed(1)}d – ${(epcis.stats.p75TransitHours!/24).toFixed(1)}d` : 'no data'}
                      badge={{ label: 'IQR', color: 'slate' }}
                      tooltip="Interquartile Range of rfid_transit_hours from RFID table."
                    />
                    <KpiCard
                      title="Mean RFID Transit"
                      value={epcis.stats.meanTransitHours != null ? `${epcis.stats.meanTransitHours}h / ${(epcis.stats.meanTransitHours / 24).toFixed(1)}d` : '—'}
                      subtitle="average transit time"
                      badge={{ label: 'avg', color: 'amber' }}
                      tooltip="Mean rfid_transit_hours from RFID table for end-to-end pairs."
                    />
                  </div>

                  {epcis.stats.byRoute.length > 0 ? (
                    <ChartCard
                      title="RFID Transit by Route"
                      subtitle={`${epcis.stats.byRoute.length} routes · avg rfid_transit_hours from RFID table`}
                      tooltip="Each row is a unique rfid_origin_country → rfid_dest_country pair from RFID table."
                    >
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-100">
                              <th className="text-left py-2 pr-4 text-slate-500 font-medium">Route (RFID)</th>
                              <th className="text-right py-2 pr-4 text-slate-500 font-medium">n</th>
                              <th className="text-right py-2 text-slate-500 font-medium">Avg Transit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {epcis.stats.byRoute.map((r, i) => (
                              <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                                <td className="py-2 pr-4 font-medium text-slate-800">{r.route}</td>
                                <td className="py-2 pr-4 text-right font-medium text-slate-700">{r.count}</td>
                                <td className="py-2 text-right">
                                  {r.avgH !== null ? (
                                    <>
                                      <span className="font-semibold text-indigo-600">{r.avgH}h</span>
                                      <span className="text-slate-400 ml-1">/ {(r.avgH / 24).toFixed(1)}d</span>
                                    </>
                                  ) : <span className="text-slate-300">—</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </ChartCard>
                  ) : (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-5">
                      <p className="font-semibold text-amber-800 text-sm mb-1">Limited transit data</p>
                      <p className="text-xs text-amber-700 leading-relaxed">
                        End-to-end transit measurement requires RFID coverage at both origin and destination. Only {epcis.stats.endToEndPairs} end-to-end pairs were found in the selected date range.
                      </p>
                    </div>
                  )}

                </div>


                 {/* ════════════════════ RFID DATA TABLE ════════════════════ */}
                <div className="mt-8">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-1 h-6 rounded-full bg-indigo-500" />
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">Tracking</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {epcis.stats.uniqueReceptacles.toLocaleString()} receptacles — one row per unique tag_id
                      </p>
                    </div>
                  </div>
                  <EpcisDataTable journeys={epcis.journeys} dateLabel={dateLabel} />
                </div>
              </>)}
          </Section>
          </>
        )}

        {/* ════════════════════ DATA TABLE ════════════════════ */}
        {activeTab === 'Data_legacy' && (
          <Section
            title="Detailed Data"
            subtitle={`All ${epcis.stats.uniqueReceptacles.toLocaleString()} receptacles from the RFID table`}
          >
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'ALL', label: 'All' },
                { key: 'FULL', label: 'FULL' },
                { key: 'EDI_ONLY', label: 'EDI Only' },
                { key: 'RFID_PREDES', label: 'RFID + PREDES' },
                { key: 'RFID_RESDES', label: 'RFID + RESDES' },
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => setTableFilter(f.key)}
                  className={`px-3 py-1.5 text-xs rounded-md border font-medium transition-all duration-150 ${
                    tableFilter === f.key
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                  }`}
                >
                  {f.label}
                  {f.key !== 'ALL' && (
                    <span className={`ml-1.5 text-[10px] font-normal ${tableFilter === f.key ? 'text-indigo-200' : 'text-slate-400'}`}>
                      {safeStats.coverageBreakdown.find(c => c.type === f.key)?.count?.toLocaleString() ?? ''}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <DataTable events={events} filterCoverage={tableFilter} dateLabel={dateLabel} />
          </Section>
        )}

      </main>

      {/* ─── Footer ─── */}
      <footer className="border-t border-slate-200 bg-white mt-10">
        <div className="container py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <img src={EDGE_LOGO} alt="EDGE by GMS" className="h-5 w-auto object-contain opacity-60" />
            <span>RFID-EDI Analysis Dashboard · {effectiveDateRange.from && effectiveDateRange.to ? `${effectiveDateRange.from} – ${effectiveDateRange.to}` : 'Jan 2026 – Mar 2026'}</span>
          </div>
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            Connected to Supabase · RFID · {epcis.stats.uniqueReceptacles.toLocaleString()} total records
          </span>
        </div>
      </footer>
    </div>
  );
}
