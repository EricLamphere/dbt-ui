import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { api } from '../../../../lib/api';
import { useTerminalEvents } from '../../../../lib/sse';

export interface TerminalInstance {
  id: string;
  label: string;
}

interface SingleTerminalProps {
  instanceId: string;
  projectPath: string;
  active: boolean;
}

const TERM_THEME = {
  background: '#0a0a0f',
  foreground: '#d4d4d8',
  cursor: '#a78bfa',
  cursorAccent: '#0a0a0f',
  selectionBackground: '#374151aa',
  black: '#1e1e2e',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#cba6f7',
  cyan: '#94e2d5',
  white: '#cdd6f4',
  brightBlack: '#45475a',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#cba6f7',
  brightCyan: '#94e2d5',
  brightWhite: '#ffffff',
};

// A single persistent terminal instance. Stays mounted even when not active (display:none).
export function SingleTerminal({ instanceId: _instanceId, projectPath, active }: SingleTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [dead, setDead] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      theme: TERM_THEME,
      fontSize: 13,
      fontFamily: '"SF Mono", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;

    fitRef.current = fit;

    const resizeIfChanged = (sid: string) => {
      const { cols, rows } = term;
      const last = lastSizeRef.current;
      if (last && last.cols === cols && last.rows === rows) return;
      lastSizeRef.current = { cols, rows };
      api.terminal.resize(sid, cols, rows).catch(() => {});
    };

    const doFitAndResize = () => {
      fit.fit();
      const sid = sessionIdRef.current;
      if (sid && term.cols && term.rows) resizeIfChanged(sid);
    };

    const ro = new ResizeObserver(() => doFitAndResize());
    ro.observe(container);

    api.terminal.start(projectPath, term.cols || 220, term.rows || 50)
      .then(({ session_id }) => {
        if (!termRef.current) { api.terminal.stop(session_id).catch(() => {}); return; }
        sessionIdRef.current = session_id;
        lastSizeRef.current = { cols: term.cols, rows: term.rows };
        setSessionId(session_id);
        requestAnimationFrame(() => { fit.fit(); });
      })
      .catch((e) => { term.writeln(`\x1b[31mFailed to start terminal: ${e}\x1b[0m`); });

    return () => {
      ro.disconnect();
      const sid = sessionIdRef.current;
      if (sid) api.terminal.stop(sid).catch(() => {});
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      sessionIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  // Re-fit whenever this terminal becomes the visible one.
  // Only send resize to the PTY if dimensions actually changed — sending SIGWINCH
  // unconditionally causes zsh to redraw the prompt, producing spurious blank lines.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      fitRef.current?.fit();
      const sid = sessionIdRef.current;
      const term = termRef.current;
      if (!sid || !term) return;
      const { cols, rows } = term;
      const last = lastSizeRef.current;
      if (!last || last.cols !== cols || last.rows !== rows) {
        lastSizeRef.current = { cols, rows };
        api.terminal.resize(sid, cols, rows).catch(() => {});
      }
    }, 30);
    return () => clearTimeout(t);
  }, [active]);

  // Wire keyboard input — filter out xterm focus-in/out sequences (\x1b[I / \x1b[O)
  // before forwarding to the PTY so zsh doesn't redraw the prompt on click.
  useEffect(() => {
    const term = termRef.current;
    if (!term || !sessionId) return;
    const d = term.onData((data) => {
      if (/^\x1b\[[IO]$/.test(data)) return;
      api.terminal.input(sessionId, data).catch(() => {});
    });
    return () => d.dispose();
  }, [sessionId]);

  // Stream output
  useTerminalEvents(sessionId, useCallback((event) => {
    if (event.type === 'init_output') {
      termRef.current?.write((event.data as { data: string }).data);
    }
    if (event.type === 'init_finished') {
      setDead(true);
      termRef.current?.writeln('\r\n\x1b[2m[process exited]\x1b[0m');
    }
  }, []));

  const handleRestart = () => {
    setDead(false);
    const sid = sessionIdRef.current;
    if (sid) api.terminal.stop(sid).catch(() => {});
    sessionIdRef.current = null;
    setSessionId(null);
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    api.terminal.start(projectPath, term.cols || 220, term.rows || 50)
      .then(({ session_id }) => {
        sessionIdRef.current = session_id;
        lastSizeRef.current = { cols: term.cols, rows: term.rows };
        setSessionId(session_id);
        fit.fit();
      })
      .catch((e) => { term.writeln(`\x1b[31mFailed to restart: ${e}\x1b[0m`); });
  };

  return (
    <div className="flex flex-col w-full h-full bg-[#0a0a0f]">
      {dead && (
        <div className="flex items-center justify-between px-3 py-1 bg-gray-900 border-b border-gray-800 shrink-0">
          <span className="text-xs text-gray-500">Process exited</span>
          <button
            onClick={handleRestart}
            className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
          >
            ↺ Restart
          </button>
        </div>
      )}
      <div ref={containerRef} className="flex-1 overflow-hidden p-1" />
    </div>
  );
}
