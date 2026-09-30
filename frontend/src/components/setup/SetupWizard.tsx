import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setupFieldError, type SettingsDto } from '../../lib/api';
import { applyTheme } from '../../lib/useTheme';
import { InstallStep } from './InstallStep';
import { PackagesStep, PreferencesStep, ProjectsStep, PythonStep, ReviewStep, WelcomeStep } from './steps';
import { defaultRequirementsPath, FIELD_STEP, STEPS, type SetupForm, type StepId, type StepProps } from './types';

const STEP_COMPONENTS: Record<Exclude<StepId, 'install'>, (props: StepProps) => JSX.Element> = {
  welcome: WelcomeStep,
  projects: ProjectsStep,
  python: PythonStep,
  packages: PackagesStep,
  preferences: PreferencesStep,
  review: ReviewStep,
};

function initialForm(settings: SettingsDto): SetupForm {
  const currentTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const projectsPath = settings.dbt_projects_path ?? '';
  const savedRequirements = settings.global_requirements_path;
  return {
    projectsPath,
    createProjectsDir: true,
    // First run starts on auto-detect; a re-run keeps whatever is configured now.
    pythonPath: settings.setup_completed ? settings.python_path ?? '' : '',
    requirementsPath: savedRequirements ?? defaultRequirementsPath(projectsPath),
    createRequirementsFile: true,
    requirementsTouched: savedRequirements != null,
    theme: settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : currentTheme,
  };
}

interface Props {
  settings: SettingsDto;
  onFinish: () => void;
}

/** First-run setup: collects the global settings, saves them in one call, then installs dbt. */
export function SetupWizard({ settings, onFinish }: Props) {
  const qc = useQueryClient();
  const isRerun = settings.setup_completed;
  const [form, setForm] = useState<SetupForm>(() => initialForm(settings));
  const [originalTheme] = useState(form.theme);
  const [step, setStep] = useState<StepId>('welcome');
  const [errors, setErrors] = useState<Partial<Record<StepId, string>>>({});
  const [saving, setSaving] = useState(false);
  const [installAttempt, setInstallAttempt] = useState(0);

  const index = STEPS.findIndex((s) => s.id === step);
  const update = (patch: Partial<SetupForm>) => {
    setForm((prev) => {
      const next = { ...prev, ...patch };
      if (patch.requirementsPath !== undefined) next.requirementsTouched = true;
      if (patch.projectsPath !== undefined && !next.requirementsTouched) {
        next.requirementsPath = defaultRequirementsPath(next.projectsPath);
      }
      return next;
    });
    setErrors((prev) => ({ ...prev, [step]: undefined }));
  };

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      const saved = await api.setup.complete({
        dbt_projects_path: form.projectsPath,
        create_projects_dir: form.createProjectsDir,
        python_path: form.pythonPath,
        global_requirements_path: form.requirementsPath,
        create_requirements_file: form.createRequirementsFile,
        theme: form.theme,
      });
      qc.setQueryData(['app-settings'], saved);
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['python-interpreters'] });
      setStep('install');
    } catch (e) {
      const fieldError = setupFieldError(e);
      if (fieldError) {
        const target = FIELD_STEP[fieldError.field];
        setErrors({ [target]: fieldError.message });
        setStep(target);
      } else {
        setErrors({ review: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      setSaving(false);
    }
  };

  const next = () => {
    if (step === 'projects' && !form.projectsPath.trim()) {
      setErrors({ projects: 'Choose a folder for your dbt projects.' });
      return;
    }
    if (step === 'review') {
      void save();
      return;
    }
    setStep(STEPS[index + 1].id);
  };

  const cancel = () => {
    applyTheme(originalTheme);
    onFinish();
  };

  const StepBody = step === 'install' ? null : STEP_COMPONENTS[step];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-surface-app">
      <div className="flex flex-col w-full max-w-2xl h-[min(640px,100%)] bg-surface-panel border border-gray-800 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-4 px-6 py-4 border-b border-gray-800 shrink-0">
          <span className="text-sm font-semibold text-brand-400">dbt-ui setup</span>
          <ol className="flex flex-1 items-center gap-1.5">
            {STEPS.map((s, i) => (
              <li
                key={s.id}
                title={s.label}
                className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-brand-500' : 'bg-gray-800'}`}
              />
            ))}
          </ol>
          {isRerun && step !== 'install' && (
            <button onClick={cancel} className="text-sm text-gray-500 hover:text-gray-300" title="Close without saving">
              ✕
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-6 py-6">
          {StepBody ? (
            <StepBody form={form} update={update} error={errors[step] ?? null} onEnter={next} />
          ) : (
            <InstallStep
              key={installAttempt}
              installing={form.requirementsPath.trim() || 'the latest dbt-core'}
              onRetry={() => setInstallAttempt((n) => n + 1)}
              onFinish={onFinish}
            />
          )}
          {step === 'review' && errors.review && <p className="mt-3 text-xs text-red-400">{errors.review}</p>}
        </div>

        {step !== 'install' && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800 shrink-0">
            <button
              onClick={() => setStep(STEPS[index - 1].id)}
              disabled={index === 0 || saving}
              className="px-3 py-1.5 text-sm rounded text-gray-400 hover:text-gray-200 disabled:invisible transition-colors"
            >
              Back
            </button>
            <button
              onClick={next}
              disabled={saving}
              className="px-4 py-2 text-sm rounded bg-brand-600 hover:bg-brand-500 text-white font-medium disabled:opacity-50 transition-colors"
            >
              {step === 'welcome' && 'Get started'}
              {step === 'review' && (saving ? 'Saving…' : 'Save & install dbt')}
              {step !== 'welcome' && step !== 'review' && 'Next'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
