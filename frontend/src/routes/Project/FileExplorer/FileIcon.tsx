import {
  Folder, FolderOpen, FileCode2, Braces, FileText, Settings, FileTerminal, Sheet, File,
} from 'lucide-react';

export function FileIcon({ name, isDir, expanded }: { name: string; isDir: boolean; expanded?: boolean }) {
  const cls = 'w-5 h-5 shrink-0';
  if (isDir) {
    return expanded
      ? <FolderOpen className={`${cls} text-yellow-400/80`} />
      : <Folder className={`${cls} text-yellow-500/70`} />;
  }
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'sql':  return <FileCode2 className={`${cls} text-brand-300`} />;
    case 'json': return <Braces className={`${cls} text-yellow-300/80`} />;
    case 'md':   return <FileText className={`${cls} text-blue-300/80`} />;
    case 'yml':
    case 'yaml':
    case 'toml': return <Settings className={`${cls} text-gray-400`} />;
    case 'sh':   return <FileTerminal className={`${cls} text-green-400/80`} />;
    case 'csv':  return <Sheet className={`${cls} text-emerald-400/80`} />;
    default:     return <File className={`${cls} text-gray-500`} />;
  }
}
