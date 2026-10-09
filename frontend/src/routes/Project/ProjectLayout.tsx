import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Outlet } from 'react-router-dom';
import { api } from '../../lib/api';
import { useModifierKeyClass } from '../../lib/useModifierKeyClass';
import { BottomPane } from './components/BottomPane';
import { CommandPalette } from './components/CommandPalette';
import { CommandPaletteContext } from './lib/commandPaletteContext';
import {
  SelectedNodeContext,
  SelectedNodeIdsContext,
  SetSelectedNodeContext,
  SetSelectedNodeIdsContext,
} from './lib/selectedNodeContext';

export default function ProjectLayout() {
  useModifierKeyClass();
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);

  const { data: graph } = useQuery({
    queryKey: ['models', id],
    queryFn: () => api.models.graph(id),
    refetchInterval: false,
    enabled: !!id,
  });

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.projects.get(id),
    refetchInterval: false,
    enabled: !!id,
  });

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<readonly string[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');

  const openPalette = useCallback((initialQuery = '') => {
    setPaletteQuery(initialQuery);
    setPaletteOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    setPaletteQuery('');
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => {
          if (open) {
            setPaletteQuery('');
            return false;
          }
          setPaletteQuery('');
          return true;
        });
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const ctxValue = useMemo(
    () => ({ open: openPalette, close: closePalette }),
    [openPalette, closePalette],
  );

  return (
    <CommandPaletteContext.Provider value={ctxValue}>
      <SetSelectedNodeContext.Provider value={setSelectedNodeId}>
      <SelectedNodeContext.Provider value={selectedNodeId}>
      <SetSelectedNodeIdsContext.Provider value={setSelectedNodeIds}>
      <SelectedNodeIdsContext.Provider value={selectedNodeIds}>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto">
          <Outlet />
        </div>
        <BottomPane
          projectId={id}
          graph={graph ?? null}
          projectPath={project?.path ?? null}
          selectedNodeId={selectedNodeId}
          selectedNodeIds={selectedNodeIds}
        />
        {paletteOpen && (
          <CommandPalette
            projectId={id}
            graph={graph ?? null}
            query={paletteQuery}
            onQueryChange={setPaletteQuery}
            onClose={closePalette}
          />
        )}
      </div>
      </SelectedNodeIdsContext.Provider>
      </SetSelectedNodeIdsContext.Provider>
      </SelectedNodeContext.Provider>
      </SetSelectedNodeContext.Provider>
    </CommandPaletteContext.Provider>
  );
}
