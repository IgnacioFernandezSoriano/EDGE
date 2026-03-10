import { ReactNode } from 'react';

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  badge?: { label: string; color: 'green' | 'amber' | 'red' | 'blue' | 'slate' };
  icon?: ReactNode;
  trend?: { value: string; positive: boolean };
}

export function KpiCard({ title, value, subtitle, badge, icon, trend }: KpiCardProps) {
  const badgeColors = {
    green: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border border-amber-200',
    red: 'bg-rose-50 text-rose-700 border border-rose-200',
    blue: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
    slate: 'bg-slate-100 text-slate-600 border border-slate-200',
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow duration-200">
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm font-medium text-slate-500 leading-tight">{title}</p>
        {icon && <div className="text-slate-400">{icon}</div>}
      </div>
      <div className="flex items-end gap-3">
        <span className="kpi-number text-3xl text-slate-900">{value}</span>
        {trend && (
          <span className={`text-sm font-medium mb-0.5 ${trend.positive ? 'text-emerald-600' : 'text-rose-600'}`}>
            {trend.value}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
        {badge && (
          <span className={`status-pill ${badgeColors[badge.color]}`}>
            {badge.label}
          </span>
        )}
      </div>
    </div>
  );
}
