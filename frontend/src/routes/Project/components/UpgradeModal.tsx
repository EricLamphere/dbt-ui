import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { api, ApiError } from '../../../lib/api';

interface UpgradeModalProps {
  onClose: () => void;
  /** Which Pro feature triggered this prompt, shown in the copy. */
  feature?: string;
}

const REASON_COPY: Record<string, string> = {
  not_licensed: 'This is a dbt-ui Pro feature. Enter your license key to unlock it.',
  not_entitled: 'Your subscription is no longer active. Renew or enter a new license key to continue.',
  unreachable: "Couldn't verify your license and the offline grace period has expired. Check your connection and try again.",
  activation_limit_reached: "This license key has reached its device activation limit. Free up a seat in your Polar customer portal, then retry.",
  grace_period: 'Your license is valid but could not be freshly verified — Pro features remain enabled for now.',
};

export function UpgradeModal({ onClose, feature = 'Column-level lineage' }: UpgradeModalProps) {
  const qc = useQueryClient();
  const [licenseKey, setLicenseKey] = useState('');
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
      if (result.entitled) onClose();
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
      if (result.entitled) onClose();
      else setError(REASON_COPY[result.reason] ?? 'Still not entitled.');
    },
  });

  const reasonCopy = license && !license.entitled ? REASON_COPY[license.reason] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface-panel border border-gray-700 rounded-lg shadow-2xl w-[440px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
            <Lock className="w-4 h-4 text-brand-400" />
            Upgrade to dbt-ui Pro
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm">✕</button>
        </div>

        <div className="px-4 py-4 flex flex-col gap-3">
          <p className="text-xs text-gray-400">
            {feature} requires an active dbt-ui Pro subscription.
          </p>
          {reasonCopy && (
            <p className="text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">
              {reasonCopy}
            </p>
          )}

          {license?.checkout_url && (
            <a
              href={license.checkout_url}
              target="_blank"
              rel="noreferrer"
              className="text-center px-3 py-2 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors"
            >
              Subscribe to dbt-ui Pro →
            </a>
          )}

          <div className="flex items-center gap-2 text-[11px] text-gray-600 my-1">
            <div className="flex-1 h-px bg-gray-800" />
            already have a license key?
            <div className="flex-1 h-px bg-gray-800" />
          </div>

          <div className="flex flex-col gap-2">
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
        </div>
      </div>
    </div>
  );
}
