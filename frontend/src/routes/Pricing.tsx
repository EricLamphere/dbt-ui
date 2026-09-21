import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Lock, Settings, Sparkles, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { GlobalSettingsModal } from '../components/GlobalSettingsModal';

const REASON_COPY: Record<string, string> = {
  not_entitled: 'Your subscription is no longer active. Renew or enter a new license key to continue.',
  unreachable: "Couldn't verify your license and the offline grace period has expired. Check your connection and try again.",
  activation_limit_reached: "This license key has reached its device activation limit. Free up a seat in your Polar customer portal, then retry.",
  grace_period: 'Your license is valid but could not be freshly verified — Pro features remain enabled for now.',
};

interface PlanFeature {
  label: string;
  base: boolean;
  pro: boolean;
}

const FEATURES: PlanFeature[] = [
  { label: 'Project discovery & multi-project workspace', base: true, pro: true },
  { label: 'Interactive DAG with live status & selector syntax', base: true, pro: true },
  { label: 'Run / build / test with streaming logs', base: true, pro: true },
  { label: 'Docs browser', base: true, pro: true },
  { label: 'File explorer & Monaco SQL/YAML editor', base: true, pro: true },
  { label: 'Integrated terminal', base: true, pro: true },
  { label: 'Init pipeline & environment profiles', base: true, pro: true },
  { label: 'Source control (Git)', base: true, pro: true },
  { label: 'SQL Workspace', base: true, pro: true },
  { label: 'Health check & schema drift', base: true, pro: true },
  { label: 'Column profiling & test coverage heatmap', base: true, pro: true },
  { label: 'Run history', base: true, pro: true },
  { label: 'Column-level lineage tracing', base: false, pro: true },
  { label: 'Priority support', base: false, pro: true },
];

function FeatureRow({ feature }: { feature: PlanFeature }) {
  return (
    <>
      <div className="flex items-center gap-2 py-1.5 pr-3 text-xs text-gray-300 border-b border-gray-800/60">
        {feature.label}
      </div>
      <div className="flex items-center justify-center py-1.5 border-b border-gray-800/60">
        {feature.base ? <Check className="w-3.5 h-3.5 text-gray-500" /> : <X className="w-3.5 h-3.5 text-gray-700" />}
      </div>
      <div className="flex items-center justify-center py-1.5 border-b border-brand-800/40 bg-brand-950/10">
        {feature.pro ? <Check className="w-3.5 h-3.5 text-brand-400" /> : <X className="w-3.5 h-3.5 text-gray-700" />}
      </div>
    </>
  );
}

export default function Pricing() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [licenseKey, setLicenseKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [manageSubscriptionOpen, setManageSubscriptionOpen] = useState(false);

  const { data: license } = useQuery({
    queryKey: ['license'],
    queryFn: () => api.license.get(),
  });

  const setKeyMutation = useMutation({
    mutationFn: (key: string) => api.license.set(key),
    onSuccess: (result) => {
      qc.setQueryData(['license'], result);
      qc.invalidateQueries({ queryKey: ['license'] });
      if (result.entitled) setError(null);
      else setError(REASON_COPY[result.reason] ?? 'License key was not accepted.');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to activate license key.');
    },
  });

  const recheckMutation = useMutation({
    mutationFn: () => api.license.recheck(),
    onSuccess: (result) => {
      qc.setQueryData(['license'], result);
      qc.invalidateQueries({ queryKey: ['license'] });
      if (result.entitled) setError(null);
      else setError(REASON_COPY[result.reason] ?? 'Still not entitled.');
    },
  });

  const isPro = !!license?.entitled;
  const reasonCopy = license && !license.entitled ? REASON_COPY[license.reason] : null;

  return (
    <div className="flex flex-col h-full overflow-auto p-6 gap-5 max-w-5xl mx-auto w-full">
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors self-start"
      >
        <ArrowLeft size={12} />
        Back
      </button>

      {/* Header */}
      <div className="flex flex-col items-center text-center gap-1.5">
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/30 text-brand-300 text-xs font-medium">
          <Sparkles size={12} />
          dbt-ui Pro
        </div>
        <h1 className="text-xl font-semibold text-gray-100">Simple, one-time upgrade</h1>
        <p className="text-xs text-gray-500 max-w-md">
          dbt-ui is free and open-source. Pro unlocks column-level lineage tracing and supports continued development.
        </p>
      </div>

      {/* Comparison card. No overflow-hidden anywhere near the sticky header —
          it would clip either the sticky positioning itself (once the header
          pins against the page's scroll container) or the "RECOMMENDED" pill,
          which deliberately pokes above the header's own box. Rounding is
          applied per-cell instead of via a clipping wrapper. */}
      <div className="rounded-xl border border-gray-800">
        {/* Plan header row — sticky so plan names/CTAs stay visible while the feature list scrolls */}
        <div className="sticky top-0 z-10 grid grid-cols-[1.4fr_1fr_1fr] border-b border-gray-800">
          <div className="p-3 rounded-tl-xl bg-surface-panel" />
          <div className="flex flex-col items-center gap-1.5 p-3 border-l border-gray-800 bg-surface-panel">
            <span className="text-xs font-semibold text-gray-200">Base — Free</span>
            <button
              disabled
              className="w-full px-2.5 py-1.5 text-[11px] rounded-md border border-gray-700 text-gray-500 cursor-default"
            >
              {isPro ? 'Included' : 'Current plan'}
            </button>
          </div>
          <div className="relative flex flex-col items-center gap-1.5 p-3 rounded-tr-xl border-l border-brand-700/50 bg-brand-950/20">
            <span className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[9px] font-semibold rounded-full bg-brand-500 text-white shadow z-20">
              RECOMMENDED
            </span>
            <span className="text-xs font-semibold text-brand-300">
              Pro — {license?.checkout_url ? 'Upgrade' : 'Contact us'}
            </span>
            {isPro ? (
              <button
                disabled
                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-md bg-brand-600/20 border border-brand-500/40 text-brand-300 cursor-default"
              >
                <Check size={11} />
                Active
              </button>
            ) : license?.checkout_url ? (
              <a
                href={license.checkout_url}
                target="_blank"
                rel="noreferrer"
                className="w-full text-center px-2.5 py-1.5 text-[11px] rounded-md bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors"
              >
                Subscribe to Pro →
              </a>
            ) : (
              <button
                disabled
                className="w-full px-2.5 py-1.5 text-[11px] rounded-md border border-gray-700 text-gray-500 cursor-default"
              >
                Checkout unavailable
              </button>
            )}
          </div>
        </div>

        {/* Feature comparison grid */}
        <div className="rounded-b-xl overflow-hidden">
          <div className="grid grid-cols-[1.4fr_1fr_1fr] px-4 bg-surface-app">
            <div className="pt-3 pb-1 text-[11px] uppercase tracking-wider text-gray-600 font-medium">Features</div>
            <div className="pt-3 pb-1 text-center text-[11px] uppercase tracking-wider text-gray-600 font-medium">Base</div>
            <div className="pt-3 pb-1 text-center text-[11px] uppercase tracking-wider text-brand-500 font-medium">Pro</div>
            {FEATURES.map((f) => (
              <FeatureRow key={f.label} feature={f} />
            ))}
          </div>
        </div>
      </div>

      {/* License key activation */}
      {!isPro && (
        <div className="flex flex-col gap-3 max-w-sm mx-auto w-full pb-6">
          {reasonCopy && (
            <p className="text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">
              {reasonCopy}
            </p>
          )}
          <div className="flex items-center gap-2 text-[11px] text-gray-600">
            <div className="flex-1 h-px bg-gray-800" />
            already have a license key?
            <div className="flex-1 h-px bg-gray-800" />
          </div>
          <input
            type="text"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
            placeholder="DBTUI_-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
            className="bg-surface-elevated border border-gray-700 rounded px-3 py-1.5 text-xs font-mono text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex items-center gap-2 justify-end">
            {license?.has_key && (
              <button
                onClick={() => {
                  setError(null);
                  recheckMutation.mutate();
                }}
                disabled={recheckMutation.isPending}
                className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200 disabled:opacity-50 transition-colors"
              >
                {recheckMutation.isPending ? 'Checking…' : 'Retry check'}
              </button>
            )}
            <button
              onClick={() => {
                setError(null);
                setKeyMutation.mutate(licenseKey.trim());
              }}
              disabled={!licenseKey.trim() || setKeyMutation.isPending}
              className="px-3 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-40 transition-colors"
            >
              {setKeyMutation.isPending ? 'Activating…' : 'Activate'}
            </button>
          </div>
        </div>
      )}

      {isPro && (
        <div className="flex flex-col items-center gap-3 pb-6">
          <div className="flex items-center justify-center gap-1.5 text-center text-brand-300 text-sm font-medium">
            <Lock size={14} />
            dbt-ui Pro is active on this device
          </div>
          <button
            onClick={() => setManageSubscriptionOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors"
          >
            <Settings size={12} />
            Manage subscription
          </button>
        </div>
      )}

      {manageSubscriptionOpen && (
        <GlobalSettingsModal onClose={() => setManageSubscriptionOpen(false)} initialTab="subscription" />
      )}
    </div>
  );
}
