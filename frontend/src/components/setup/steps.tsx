import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { applyTheme } from '../../lib/useTheme';
import { Choice, InlineCode, PathInput, StepHeading } from './fields';
import type { SetupForm, StepProps } from './types';

export function WelcomeStep() {
  return (
    <>
      <StepHeading title="Welcome to dbt-ui">
        A few quick questions to get you set up. Everything here can be changed later in Global Settings.
      </StepHeading>
      <ol className="flex flex-col gap-2 text-sm text-gray-300 list-decimal list-inside">
        <li>Where your dbt projects live</li>
        <li>Which Python dbt should run on</li>
        <li>Which dbt packages to install</li>
        <li>A couple of preferences</li>
      </ol>
      <p className="mt-5 text-xs text-gray-500">
        At the end, dbt-ui installs dbt into its own isolated environment. Nothing is installed into your system Python.
      </p>
    </>
  );
}

export function ProjectsStep({ form, update, error, onEnter }: StepProps) {
  return (
    <>
      <StepHeading title="Where are your dbt projects?">
        dbt-ui scans this folder (and its subfolders) for <InlineCode className="text-gray-300">dbt_project.yml</InlineCode> files.
        New projects you create in dbt-ui go here too.
      </StepHeading>
      <PathInput
        label="Projects folder"
        value={form.projectsPath}
        onChange={(projectsPath) => update({ projectsPath })}
        onEnter={onEnter}
        placeholder="~/dbt-projects"
        error={error}
      />
      <label className="flex items-center gap-2 mt-3 text-xs text-gray-400 cursor-pointer">
        <input
          type="checkbox"
          checked={form.createProjectsDir}
          onChange={(e) => update({ createProjectsDir: e.target.checked })}
          className="accent-brand-500"
        />
        Create this folder if it doesn't exist
      </label>
    </>
  );
}

export function PythonStep({ form, update, error }: StepProps) {
  const qc = useQueryClient();
  const { data: interpreters, isFetching } = useQuery({
    queryKey: ['python-interpreters'],
    queryFn: () => api.settings.pythonInterpreters(),
  });

  return (
    <>
      <StepHeading title="Which Python should dbt run on?">
        dbt runs in its own virtual environment, built from a Python 3.11+ install on this machine.
      </StepHeading>
      <div className="flex flex-col gap-2">
        <Choice
          selected={form.pythonPath === ''}
          onSelect={() => update({ pythonPath: '' })}
          title="Auto-detect (recommended)"
          detail="Newest of python3.13, 3.12, 3.11 found on this machine"
        />
        {interpreters?.map((p) => (
          <Choice
            key={p.path}
            selected={form.pythonPath === p.path}
            onSelect={() => update({ pythonPath: p.path })}
            title={`Python ${p.version}`}
            detail={p.path}
          />
        ))}
        {!interpreters && <p className="px-1 text-xs text-gray-500 italic">Scanning for Python installs…</p>}
        {interpreters?.length === 0 && (
          <p className="px-1 text-xs text-amber-300">
            No Python 3.11+ found. Install one (e.g. from python.org or Homebrew), then rescan.
          </p>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <button
        type="button"
        onClick={() => qc.invalidateQueries({ queryKey: ['python-interpreters'] })}
        disabled={isFetching}
        className="flex items-center gap-1.5 mt-3 text-xs text-gray-500 hover:text-gray-300 disabled:opacity-50"
      >
        <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
        Rescan
      </button>
    </>
  );
}

export function PackagesStep({ form, update, error, onEnter }: StepProps) {
  return (
    <>
      <StepHeading title="Which dbt packages should be installed?">
        A <InlineCode className="text-gray-300">requirements.txt</InlineCode> listing dbt-core and the adapters you use.
        Clear the field to just install the latest dbt-core.
      </StepHeading>
      <PathInput
        label="Global requirements file (optional)"
        value={form.requirementsPath}
        onChange={(requirementsPath) => update({ requirementsPath })}
        onEnter={onEnter}
        placeholder="~/dbt-projects/requirements.txt"
        error={error}
        hint={
          <>
            dbt also needs an adapter for your warehouse (e.g. <InlineCode>dbt-duckdb</InlineCode>,{' '}
            <InlineCode>dbt-snowflake</InlineCode>). List it here, or per project with REQUIREMENTS_PATH.
          </>
        }
      />
      {form.requirementsPath.trim() && (
        <label className="flex items-center gap-2 mt-3 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={form.createRequirementsFile}
            onChange={(e) => update({ createRequirementsFile: e.target.checked })}
            className="accent-brand-500"
          />
          Create this file if it doesn't exist (it will start with dbt-core)
        </label>
      )}
    </>
  );
}

export function PreferencesStep({ form, update }: StepProps) {
  const choose = (theme: SetupForm['theme']) => {
    applyTheme(theme);
    update({ theme });
  };
  return (
    <>
      <StepHeading title="Preferences" />
      <span className="block mb-2 text-xs font-medium text-gray-300">Theme</span>
      <div className="grid grid-cols-2 gap-2">
        <Choice selected={form.theme === 'dark'} onSelect={() => choose('dark')} title="Dark" />
        <Choice selected={form.theme === 'light'} onSelect={() => choose('light')} title="Light" />
      </div>
    </>
  );
}

export function ReviewStep({ form }: StepProps) {
  const rows: [string, string][] = [
    ['Projects folder', form.projectsPath.trim()],
    ['Python', form.pythonPath || 'Auto-detect'],
    ['Installs', form.requirementsPath.trim() || 'Latest dbt-core'],
    ['Theme', form.theme === 'dark' ? 'Dark' : 'Light'],
  ];
  return (
    <>
      <StepHeading title="Ready to set up">
        dbt-ui will save these settings, then install dbt. This can take a minute or two.
      </StepHeading>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 px-4 py-3 bg-surface-elevated border border-gray-800 rounded text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-gray-500">{label}</dt>
            <dd className="font-mono text-gray-200 break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
