/**
 * AnalysisPanel — dynamic interpretation block rendered at the bottom of each tab.
 * Reads real computed stats and generates contextual English analysis.
 * Design: Operational Intelligence — clean white + slate + indigo accent
 */

import { DashboardStats } from '@/hooks/useTrackingData';

interface Finding {
  icon: string;
  label: string;
  text: string;
  color: 'indigo' | 'emerald' | 'amber' | 'rose' | 'sky' | 'slate';
}

const colorMap: Record<Finding['color'], { bg: string; border: string; icon: string; label: string }> = {
  indigo:  { bg: 'bg-indigo-50',  border: 'border-indigo-200',  icon: 'text-indigo-500',  label: 'text-indigo-700' },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: 'text-emerald-500', label: 'text-emerald-700' },
  amber:   { bg: 'bg-amber-50',   border: 'border-amber-200',   icon: 'text-amber-500',   label: 'text-amber-700' },
  rose:    { bg: 'bg-rose-50',    border: 'border-rose-200',    icon: 'text-rose-500',    label: 'text-rose-700' },
  sky:     { bg: 'bg-sky-50',     border: 'border-sky-200',     icon: 'text-sky-500',     label: 'text-sky-700' },
  slate:   { bg: 'bg-slate-50',   border: 'border-slate-200',   icon: 'text-slate-500',   label: 'text-slate-700' },
};

function FindingCard({ f }: { f: Finding }) {
  const c = colorMap[f.color];
  return (
    <div className={`rounded-xl border ${c.bg} ${c.border} p-4 flex gap-3`}>
      <span className={`text-xl mt-0.5 flex-shrink-0 ${c.icon}`}>{f.icon}</span>
      <div>
        <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${c.label}`}>{f.label}</p>
        <p className="text-sm text-slate-700 leading-relaxed">{f.text}</p>
      </div>
    </div>
  );
}

/* ─── Overview analysis ─── */
export function OverviewAnalysis({ s }: { s: DashboardStats }) {
  const fullPct = Math.round((s.fullCoverage / s.totalReceptacles) * 100);
  const ediOnlyPct = Math.round((s.ediOnly / s.totalReceptacles) * 100);
  const rfidOnlyPct = Math.round((s.rfidOnly / s.totalReceptacles) * 100);

  const findings: Finding[] = [];

  // Coverage quality
  if (fullPct >= 50) {
    findings.push({
      icon: '✅', label: 'Coverage Quality',
      text: `${fullPct}% of receptacles have full RFID + PREDES + RESDES coverage, which is sufficient for robust statistical analysis across all three dimensions (departure, arrival, and transit). This coverage level supports reliable median calculations and route-level comparisons.`,
      color: 'emerald',
    });
  } else {
    findings.push({
      icon: '⚠️', label: 'Coverage Quality',
      text: `Only ${fullPct}% of receptacles have full RFID + PREDES + RESDES coverage. Partial coverage limits the scope of analysis — departure and arrival metrics are computed on subsets, and route-level transit comparisons may be statistically thin for some corridors.`,
      color: 'amber',
    });
  }

  // EDI-only gap
  if (ediOnlyPct > 20) {
    findings.push({
      icon: '📭', label: 'RFID Gap',
      text: `${ediOnlyPct}% of receptacles have EDI messages but no RFID reading. These receptacles passed through the postal network without being detected by any RFID-equipped centre in this dataset. This may indicate infrastructure gaps at certain origin or destination facilities, or routing through non-RFID corridors.`,
      color: 'rose',
    });
  } else {
    findings.push({
      icon: '📡', label: 'RFID Penetration',
      text: `RFID penetration is strong: only ${rfidOnlyPct}% of receptacles have RFID without EDI, and ${ediOnlyPct}% have EDI without RFID. The high overlap between physical tracking and administrative messaging enables meaningful comparison across the majority of flows.`,
      color: 'sky',
    });
  }

  // Departure vs Arrival balance
  findings.push({
    icon: '⏱️', label: 'Timing Summary',
    text: `The median departure lag is +${s.departureMedianHours}h (${(s.departureMedianHours/24).toFixed(1)}d) — RFID is detected after PREDES, consistent with the standard workflow where administrative dispatch precedes physical departure. At arrival, RFID leads RESDES by a median of ${Math.abs(s.arrivalMedianHours).toFixed(1)}h (${(Math.abs(s.arrivalMedianHours)/24).toFixed(1)}d), demonstrating a clear real-time visibility advantage at the destination end.`,
    color: 'indigo',
  });

  // Transit accuracy
  if (Math.abs(s.transitDiffMedian) > 24) {
    findings.push({
      icon: '🔍', label: 'Transit Accuracy',
      text: `The median gap between EDI-declared and RFID-measured transit is ${s.transitDiffMedian > 0 ? '+' : ''}${s.transitDiffMedian}h (${(Math.abs(s.transitDiffMedian)/24).toFixed(1)}d). This ${s.transitDiffMedian > 0 ? 'overestimation' : 'underestimation'} by EDI exceeds one day, suggesting that PREDES/RESDES timestamps do not accurately reflect the physical movement of receptacles on these corridors. RFID provides a more precise measure of actual transit duration.`,
      color: 'amber',
    });
  } else {
    findings.push({
      icon: '🎯', label: 'Transit Accuracy',
      text: `EDI-declared transit deviates from RFID-measured physical transit by a median of ${s.transitDiffMedian > 0 ? '+' : ''}${s.transitDiffMedian}h — within one day. This indicates reasonable alignment between administrative declarations and physical movement on the validated routes, though route-level variation may still be significant.`,
      color: 'emerald',
    });
  }

  return <AnalysisPanel title="Overall Assessment" findings={findings} />;
}

/* ─── Departure analysis ─── */
export function DepartureAnalysis({ s }: { s: DashboardStats }) {
  const iqrHours = s.departureP75 - s.departureP25;
  const worstCentre = s.departureByCentre.length > 0
    ? s.departureByCentre.reduce((a, b) => Math.abs(b.median) > Math.abs(a.median) ? b : a)
    : null;
  const bestCentre = s.departureByCentre.length > 0
    ? s.departureByCentre.reduce((a, b) => Math.abs(b.median) < Math.abs(a.median) ? b : a)
    : null;

  const findings: Finding[] = [];

  // Median interpretation
  findings.push({
    icon: '📦', label: 'Departure Lag Pattern',
    text: `The median departure lag of +${s.departureMedianHours}h (${(s.departureMedianHours/24).toFixed(1)} days) reflects the standard operational workflow: PREDES is issued when the dispatch is administratively prepared, typically 2–3 days before the receptacle physically departs and is detected by RFID. A positive lag is expected and operationally normal in this context.`,
    color: 'indigo',
  });

  // IQR / variability
  if (iqrHours > 72) {
    findings.push({
      icon: '📊', label: 'High Variability',
      text: `The interquartile range spans ${s.departureP25}h to ${s.departureP75}h (IQR = ${iqrHours}h / ${(iqrHours/24).toFixed(1)}d), indicating significant variability in departure timing across different flows. This wide spread suggests heterogeneous operational practices across origin countries or centres — some operators issue PREDES much earlier than others relative to physical departure.`,
      color: 'amber',
    });
  } else {
    findings.push({
      icon: '📊', label: 'Consistent Timing',
      text: `The interquartile range spans ${s.departureP25}h to ${s.departureP75}h (IQR = ${iqrHours}h / ${(iqrHours/24).toFixed(1)}d), indicating relatively consistent departure timing across the middle 50% of flows. The distribution is reasonably concentrated, suggesting similar operational practices across most origin operators.`,
      color: 'emerald',
    });
  }

  // Anomalous cases (RFID before PREDES)
  if (s.departureRfidBeforePct > 10) {
    findings.push({
      icon: '⚠️', label: 'Anomalous Cases',
      text: `${s.departureRfidBeforePct}% of receptacles (${s.departureRfidBefore} cases) show RFID detection before the PREDES message — which is technically anomalous. Likely causes include EDI transmission delays at specific origin operators, pre-loading of receptacles before administrative processing, or timestamp inconsistencies. These cases warrant investigation at the affected centres.`,
      color: 'rose',
    });
  } else {
    findings.push({
      icon: '✅', label: 'Anomalous Cases',
      text: `Only ${s.departureRfidBeforePct}% of receptacles (${s.departureRfidBefore} cases) show RFID detection before PREDES — within the acceptable threshold. The vast majority of flows follow the expected sequence: administrative dispatch (PREDES) precedes physical detection (RFID).`,
      color: 'emerald',
    });
  }

  // Centre-level insight
  if (worstCentre && bestCentre && worstCentre.centre !== bestCentre.centre) {
    findings.push({
      icon: '🏭', label: 'Centre-Level Variation',
      text: `The largest departure lag is at ${worstCentre.centre} (${worstCentre.median.toFixed(0)}h / ${(worstCentre.median/24).toFixed(1)}d, n=${worstCentre.n}), while ${bestCentre.centre} shows the smallest gap (${bestCentre.median.toFixed(0)}h / ${(bestCentre.median/24).toFixed(1)}d, n=${bestCentre.n}). This ${(Math.abs(worstCentre.median - bestCentre.median)/24).toFixed(1)}-day spread between centres suggests that PREDES issuance timing is not uniform across origin postal operators.`,
      color: 'sky',
    });
  }

  return <AnalysisPanel title="Departure Analysis — Key Findings" findings={findings} />;
}

/* ─── Arrival analysis ─── */
export function ArrivalAnalysis({ s }: { s: DashboardStats }) {
  const rfidAfterPct = 100 - s.arrivalRfidBeforePct;
  const bestArrival = s.arrivalByCentre.length > 0
    ? s.arrivalByCentre.filter(c => c.median < 0).sort((a, b) => a.median - b.median)[0]
    : null;
  const worstArrival = s.arrivalByCentre.length > 0
    ? s.arrivalByCentre.sort((a, b) => b.rfidBeforePct - a.rfidBeforePct)[0]
    : null;

  const findings: Finding[] = [];

  // Core RFID advantage
  if (s.arrivalRfidBeforePct >= 60) {
    findings.push({
      icon: '🚀', label: 'RFID Real-Time Advantage',
      text: `In ${s.arrivalRfidBeforePct}% of arrival events, RFID detects the receptacle before the RESDES message is generated — with a median lead of ${Math.abs(s.arrivalMedianHours).toFixed(1)}h (${(Math.abs(s.arrivalMedianHours)/24).toFixed(1)}d). This is a strong demonstration of RFID's real-time visibility advantage: the physical arrival is known significantly earlier than the administrative acknowledgement.`,
      color: 'emerald',
    });
  } else if (s.arrivalRfidBeforePct >= 40) {
    findings.push({
      icon: '⚖️', label: 'Mixed RFID Performance',
      text: `RFID detects the receptacle before RESDES in ${s.arrivalRfidBeforePct}% of cases, while EDI is faster in the remaining ${rfidAfterPct}%. The median lead/lag of ${s.arrivalMedianHours.toFixed(1)}h indicates a roughly balanced performance. The value of RFID varies significantly by destination centre and corridor.`,
      color: 'amber',
    });
  } else {
    findings.push({
      icon: '📋', label: 'EDI Dominates at Arrival',
      text: `EDI (RESDES) precedes RFID detection in ${rfidAfterPct}% of arrival events. The median lag of +${s.arrivalMedianHours.toFixed(1)}h means RFID typically arrives later than the administrative message. This may indicate slow RFID scanning at destination centres, or very fast EDI processing by destination operators.`,
      color: 'rose',
    });
  }

  // Centre with best RFID advantage
  if (bestArrival) {
    findings.push({
      icon: '🏆', label: 'Best-Performing Destination',
      text: `${bestArrival.centre} shows the strongest RFID advantage at arrival: median lead of ${Math.abs(bestArrival.median).toFixed(0)}h (${(Math.abs(bestArrival.median)/24).toFixed(1)}d) before RESDES, with ${bestArrival.rfidBeforePct}% of receptacles detected before the EDI message. This centre represents the highest operational value of RFID in the dataset.`,
      color: 'emerald',
    });
  }

  // Centre with highest RFID-before rate
  if (worstArrival && worstArrival.rfidBeforePct > 80) {
    findings.push({
      icon: '📡', label: 'RFID Dominance',
      text: `${worstArrival.centre} has the highest RFID-before-RESDES rate at ${worstArrival.rfidBeforePct}%, meaning RFID almost always provides earlier visibility than EDI at this destination. This centre is a strong candidate for real-time operational decisions based on RFID data alone.`,
      color: 'sky',
    });
  }

  // Operational implication
  findings.push({
    icon: '💡', label: 'Operational Implication',
    text: `The ${s.arrivalRfidBeforePct}% RFID-before-RESDES rate means that for the majority of arrivals, a tracking system relying solely on EDI would be ${Math.abs(s.arrivalMedianHours).toFixed(0)}h (${(Math.abs(s.arrivalMedianHours)/24).toFixed(1)}d) behind the physical reality. RFID enables proactive operational decisions — such as customs pre-clearance, delivery scheduling, and exception management — that EDI alone cannot support in real time.`,
    color: 'indigo',
  });

  return <AnalysisPanel title="Arrival Analysis — Key Findings" findings={findings} />;
}

/* ─── Transit analysis ─── */
export function TransitAnalysis({ s }: { s: DashboardStats }) {
  const overestimate = s.transitDiffMedian > 0;
  const bestRoute = s.transitRoutes.length > 0
    ? s.transitRoutes.reduce((a, b) => Math.abs(b.diff) < Math.abs(a.diff) ? b : a)
    : null;
  const worstRoute = s.transitRoutes.length > 0
    ? s.transitRoutes.reduce((a, b) => Math.abs(b.diff) > Math.abs(a.diff) ? b : a)
    : null;

  const findings: Finding[] = [];

  // Overall transit gap
  findings.push({
    icon: overestimate ? '📈' : '📉', label: 'EDI vs RFID Transit Gap',
    text: `EDI-declared transit ${overestimate ? 'overestimates' : 'underestimates'} physical transit by a median of ${Math.abs(s.transitDiffMedian)}h (${(Math.abs(s.transitDiffMedian)/24).toFixed(1)}d). RFID measures a median physical transit of ${s.rfidTransitMedian}h (${(s.rfidTransitMedian/24).toFixed(1)}d), while EDI declares ${s.ediTransitMedian}h (${(s.ediTransitMedian/24).toFixed(1)}d). ${overestimate ? 'The EDI overestimation likely reflects the gap between administrative dispatch preparation (PREDES) and actual physical departure.' : 'EDI underestimation may indicate that RESDES is issued before the receptacle is fully processed at the destination.'}`,
    color: overestimate ? 'amber' : 'sky',
  });

  // Route coverage
  findings.push({
    icon: '🗺️', label: 'Route Coverage',
    text: `${s.transitPairs} receptacles have validated end-to-end RFID coverage across ${s.transitRoutes.length} distinct origin→destination route${s.transitRoutes.length !== 1 ? 's' : ''}. End-to-end validation requires RFID detection at both the origin and destination centre, which limits coverage to corridors where both endpoints are RFID-equipped.`,
    color: 'indigo',
  });

  // Best-accuracy route
  if (bestRoute) {
    findings.push({
      icon: '🎯', label: 'Most Accurate Route',
      text: `The route with the smallest EDI/RFID gap is ${bestRoute.route}: RFID measures ${bestRoute.rfidMedian.toFixed(0)}h (${(bestRoute.rfidMedian/24).toFixed(1)}d) vs EDI-declared ${bestRoute.ediMedian.toFixed(0)}h (${(bestRoute.ediMedian/24).toFixed(1)}d) — a difference of only ${Math.abs(bestRoute.diff).toFixed(0)}h. This corridor has the most reliable EDI declarations relative to physical movement.`,
      color: 'emerald',
    });
  }

  // Worst-accuracy route
  if (worstRoute && worstRoute !== bestRoute) {
    findings.push({
      icon: '⚠️', label: 'Largest Discrepancy',
      text: `The route with the largest EDI/RFID gap is ${worstRoute.route}: RFID measures ${worstRoute.rfidMedian.toFixed(0)}h (${(worstRoute.rfidMedian/24).toFixed(1)}d) vs EDI-declared ${worstRoute.ediMedian.toFixed(0)}h (${(worstRoute.ediMedian/24).toFixed(1)}d) — a ${Math.abs(worstRoute.diff).toFixed(0)}h (${(Math.abs(worstRoute.diff)/24).toFixed(1)}d) discrepancy. This suggests that PREDES/RESDES timestamps on this corridor do not accurately reflect the physical movement timeline.`,
      color: 'rose',
    });
  }

  // Value of RFID for transit
  findings.push({
    icon: '💡', label: 'Value of RFID Measurement',
    text: `RFID-measured transit times provide an independent, objective measure of physical movement that is not subject to administrative processing delays or pre-advice timing conventions. The ${Math.abs(s.transitDiffMedian)}h systematic gap between RFID and EDI demonstrates that EDI alone is insufficient for accurate transit time monitoring — RFID is essential for operational performance management on international postal corridors.`,
    color: 'indigo',
  });

  return <AnalysisPanel title="Transit Analysis — Key Findings" findings={findings} />;
}

/* ─── Base panel wrapper ─── */
function AnalysisPanel({ title, findings }: { title: string; findings: Finding[] }) {
  return (
    <div className="mt-2 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
        <span className="text-base">🔬</span>
        <h3 className="text-sm font-semibold text-slate-800 tracking-tight">{title}</h3>
      </div>
      <div className="p-5 grid md:grid-cols-2 gap-4">
        {findings.map((f, i) => <FindingCard key={i} f={f} />)}
      </div>
    </div>
  );
}
