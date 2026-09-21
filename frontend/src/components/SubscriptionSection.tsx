import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, CheckCircle2, AlertTriangle, Monitor, RefreshCw } from 'lucide-react';
import { api, ApiError, type LicenseStatusDto } from '../lib/api';

const REASON_COPY: Record<string, string> = {
  not_entitled: 'Your subscription is no longer active. Renew or enter a new license key below.',
  unreachable: "Couldn't verify your license and the offline grace period has expired. Check your connection and try again.",
  activation_limit_reached: 'This license key has reached its device activation limit. Free up a seat in your Polar customer portal, then retry.',
  grace_period: 'Your license is valid but could not be freshly verified — Pro features remain enabled for now.',
};

export function SubscriptionSection() {
  const qc = useQueryClient();
  const { data: license } = useQuery({
    queryKey: ['license'],
    queryFn: () => api.license.get(),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Subscription</h3>
        <p className="text-xs text-gray-500">Your dbt-ui Pro license, shared across all projects on this installation.</p>
      </div>

      {license && (license.has_key
        ? <SubscribedView license={license} qc={qc} />
        : <UnsubscribedView qc={qc} />)}
    </div>
  );
}

// ---- Subscribed ----

function SubscribedView({ license, qc }: { license: LicenseStatusDto; qc: ReturnType<typeof useQueryClient> }) {
  const [revealed, setRevealed] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const cancelMutation = useMutation({
    mutationFn: () => api.license.cancel(),
    onSuccess: () => {
      setConfirmingCancel(false);
      qc.invalidateQueries({ queryKey: ['license'] });
    },
    onError: (err) => {
      setCancelError(err instanceof ApiError ? err.message : 'Failed to cancel subscription.');
    },
  });

  const reasonCopy = !license.entitled ? REASON_COPY[license.reason] : null;
  const key = license.license_key ?? '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-xs">
        {license.entitled ? (
          <>
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-gray-200 font-medium">dbt-ui Pro is active</span>
          </>
        ) : (
          <>
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-gray-200 font-medium">License on file, but not currently active</span>
          </>
        )}
      </div>

      {reasonCopy && (
        <p className="text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">
          {reasonCopy}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-gray-500 uppercase tracking-wide">License key</span>
        <div className="flex items-center gap-2 bg-surface-panel border border-gray-800 rounded px-3 py-2">
          <span className="flex-1 font-mono text-xs text-gray-300 truncate select-all">
            {revealed ? key : '•'.repeat(Math.min(key.length, 40) || 32)}
          </span>
          <button
            onClick={() => setRevealed((v) => !v)}
            title={revealed ? 'Hide license key' : 'Reveal license key'}
            className="text-gray-500 hover:text-gray-300 p-1 shrink-0"
          >
            {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <p className="text-[11px] text-gray-600">
          Anyone with this key can activate a device on it — don't share it. If you see more devices below than you
          recognize, someone else may have your key.
        </p>
      </div>

      {license.can_view_activations && <ActivationsRow limit={license.limit_activations} />}

      <div className="flex flex-col gap-2 pt-2 border-t border-gray-800">
        {!confirmingCancel ? (
          <button
            onClick={() => { setCancelError(null); setConfirmingCancel(true); }}
            className="self-start px-3 py-1.5 text-xs rounded border border-red-900/60 text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Cancel subscription
          </button>
        ) : (
          <div className="flex flex-col gap-2 bg-red-500/5 border border-red-900/50 rounded px-3 py-2.5">
            <p className="text-xs text-gray-300">
              This cancels your dbt-ui Pro subscription at the end of the current billing period — you'll keep Pro
              access until then. This can't be undone from here.
            </p>
            {cancelError && <p className="text-xs text-red-400">{cancelError}</p>}
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setConfirmingCancel(false)}
                disabled={cancelMutation.isPending}
                className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200 disabled:opacity-50 transition-colors"
              >
                Keep subscription
              </button>
              <button
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="px-3 py-1.5 text-xs rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-40 transition-colors"
              >
                {cancelMutation.isPending ? 'Cancelling…' : 'Confirm cancellation'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Activation count ----

function ActivationsRow({ limit }: { limit: number | null }) {
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ['license-activations'],
    queryFn: () => api.license.activations(),
    staleTime: 0,
  });

  const count = data?.count ?? null;
  const effectiveLimit = data?.limit ?? limit;
  const atLimit = count !== null && effectiveLimit !== null && count >= effectiveLimit;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] text-gray-500 uppercase tracking-wide">Devices</span>
      <div
        className={`flex items-center gap-2 border rounded px-3 py-2 ${
          atLimit ? 'bg-amber-500/10 border-amber-500/30' : 'bg-surface-panel border-gray-800'
        }`}
      >
        <Monitor className={`w-3.5 h-3.5 shrink-0 ${atLimit ? 'text-amber-400' : 'text-gray-500'}`} />
        <span className={`flex-1 text-xs ${atLimit ? 'text-amber-300' : 'text-gray-300'}`}>
          {isError
            ? "Couldn't load device count"
            : count === null
              ? 'Loading…'
              : `${count} of ${effectiveLimit ?? '∞'} device${effectiveLimit === 1 ? '' : 's'} activated`}
        </span>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          title="Refresh device count"
          className="text-gray-500 hover:text-gray-300 p-1 shrink-0 disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
}

// ---- Not subscribed ----

function UnsubscribedView({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const [licenseKey, setLicenseKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: license } = useQuery({
    queryKey: ['license'],
    queryFn: () => api.license.get(),
  });

  const setKeyMutation = useMutation({
    mutationFn: (key: string) => api.license.set(key),
    onSuccess: (result) => {
      qc.setQueryData(['license'], result);
      qc.invalidateQueries({ queryKey: ['license'] });
      if (!result.entitled) setError(REASON_COPY[result.reason] ?? 'License key was not accepted.');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to activate license key.');
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-xs">
        <AlertTriangle className="w-4 h-4 text-gray-500 shrink-0" />
        <span className="text-gray-300">No active dbt-ui Pro subscription</span>
      </div>

      <div className="flex items-center gap-2">
        {license?.checkout_url && (
          <a
            href={license.checkout_url}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors"
          >
            Subscribe to Pro
          </a>
        )}
        <button
          onClick={() => setShowKeyInput((v) => !v)}
          className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
        >
          Have a license key?
        </button>
      </div>

      {showKeyInput && (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
            placeholder="DBTUI_-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
            className="bg-surface-elevated border border-gray-700 rounded px-3 py-1.5 text-xs font-mono text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            onClick={() => {
              setError(null);
              setKeyMutation.mutate(licenseKey.trim());
            }}
            disabled={!licenseKey.trim() || setKeyMutation.isPending}
            className="self-end px-3 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-40 transition-colors"
          >
            {setKeyMutation.isPending ? 'Activating…' : 'Activate'}
          </button>
        </div>
      )}
    </div>
  );
}
