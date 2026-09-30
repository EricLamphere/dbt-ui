import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { LoadingScreen } from './LoadingScreen';
import { SetupWizard } from './SetupWizard';

export const OPEN_SETUP_EVENT = 'dbt-ui:open-setup';

// How often to retry while the backend is still starting (dev: `task start`
// pip-installs before uvicorn launches; packaged: the sidecar is booting). The
// default React Query backoff (1s, 2s, 4s…) left the UI idle for seconds after
// the server was already up.
const BOOT_RETRY_MS = 250;

/**
 * Gates the whole app on the first settings response:
 * - backend not answering yet → full-screen loading screen (never a half-rendered Home)
 * - setup not completed → the setup wizard, instead of the app behind it
 * - otherwise → the app; the wizard can be reopened via OPEN_SETUP_EVENT
 */
export function SetupGate({ children }: { children: ReactNode }) {
  const { data: settings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => api.settings.get(),
    retry: true,
    retryDelay: BOOT_RETRY_MS,
  });
  // Latched: saving mid-wizard flips setup_completed to true, but the wizard
  // must stay up through the install step until the user finishes it.
  const [wizardOpen, setWizardOpen] = useState(false);
  const [bootStart] = useState(() => Date.now());
  const [waitedSecs, setWaitedSecs] = useState(0);

  useEffect(() => {
    if (settings && !settings.setup_completed) setWizardOpen(true);
  }, [settings?.setup_completed]);

  useEffect(() => {
    const handler = () => setWizardOpen(true);
    window.addEventListener(OPEN_SETUP_EVENT, handler);
    return () => window.removeEventListener(OPEN_SETUP_EVENT, handler);
  }, []);

  // Tick only while booting, to escalate the loading screen's message.
  useEffect(() => {
    if (settings) return;
    const id = setInterval(() => setWaitedSecs(Math.floor((Date.now() - bootStart) / 1000)), 1000);
    return () => clearInterval(id);
  }, [settings, bootStart]);

  if (!settings) return <LoadingScreen waitedSecs={waitedSecs} />;
  if (wizardOpen || !settings.setup_completed) {
    return <SetupWizard settings={settings} onFinish={() => setWizardOpen(false)} />;
  }
  return <>{children}</>;
}
