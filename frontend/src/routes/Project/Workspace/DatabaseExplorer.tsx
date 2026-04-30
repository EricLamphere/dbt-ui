import { useState } from 'react';
import { ChevronRight, ChevronDown, Database, Table2, Layers, RefreshCw } from 'lucide-react';
import type { ModelNode } from '../../../lib/api';

interface DatabaseExplorerProps {
  nodes: ModelNode[];
  onRefresh: () => void;
}

interface SectionProps {
  label: string;
  icon: React.ReactNode;
  items: ModelNode[];
  getLabel: (node: ModelNode) => string;
  getDragText: (node: ModelNode) => string;
}

function ExplorerSection({ label, icon, items, getLabel, getDragText }: SectionProps) {
  const [expanded, setExpanded] = useState(true);

  if (items.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-200 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        {icon}
        <span className="truncate">{label}</span>
        <span className="ml-auto text-gray-600 font-normal normal-case tracking-normal">{items.length}</span>
      </button>

      {expanded && (
        <div className="pl-1">
          {items.map((node) => {
            const displayLabel = getLabel(node);
            const dragText = getDragText(node);
            return (
              <div
                key={node.unique_id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', dragText);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                title={`Drag to insert ${dragText}`}
                className="flex items-center gap-1.5 px-3 py-0.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-surface-elevated rounded cursor-grab active:cursor-grabbing transition-colors select-none"
              >
                <span className="font-mono truncate">{displayLabel}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DatabaseExplorer({ nodes, onRefresh }: DatabaseExplorerProps) {
  const models = nodes.filter((n) => n.resource_type === 'model');
  const seeds = nodes.filter((n) => n.resource_type === 'seed');
  const sources = nodes.filter((n) => n.resource_type === 'source');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-2 border-b border-gray-800 shrink-0">
        <Database className="w-3.5 h-3.5 text-gray-500" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Database Explorer</span>
        <button
          onClick={onRefresh}
          title="Refresh"
          className="ml-auto p-0.5 text-gray-600 hover:text-gray-300 transition-colors rounded"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1 space-y-0.5">
        <ExplorerSection
          label="Models"
          icon={<Layers className="w-3 h-3 shrink-0" />}
          items={models}
          getLabel={(n) => n.name}
          getDragText={(n) => `{{ ref('${n.name}') }}`}
        />
        <ExplorerSection
          label="Seeds"
          icon={<Table2 className="w-3 h-3 shrink-0" />}
          items={seeds}
          getLabel={(n) => n.name}
          getDragText={(n) => `{{ ref('${n.name}') }}`}
        />
        <ExplorerSection
          label="Sources"
          icon={<Database className="w-3 h-3 shrink-0" />}
          items={sources}
          getLabel={(n) => n.source_name ? `${n.source_name}.${n.name}` : n.name}
          getDragText={(n) => n.source_name ? `{{ source('${n.source_name}', '${n.name}') }}` : n.name}
        />

        {models.length === 0 && seeds.length === 0 && sources.length === 0 && (
          <p className="text-xs text-gray-600 italic px-3 py-2">No dbt resources found.</p>
        )}
      </div>
    </div>
  );
}
