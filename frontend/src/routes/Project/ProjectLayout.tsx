import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Outlet } from 'react-router-dom';
import { api } from '../../lib/api';
import { BottomPane } from './components/BottomPane';

export default function ProjectLayout() {
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
      <BottomPane projectId={id} graph={graph ?? null} projectPath={project?.path ?? null} />
    </div>
  );
}
