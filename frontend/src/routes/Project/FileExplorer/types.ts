import type { FileNode } from '../../../lib/api';

export type TreeNode = Omit<FileNode, 'children'> & { expanded?: boolean; children?: TreeNode[] };

export interface ContextMenuState {
  x: number;
  y: number;
  node: TreeNode;
  pathParts: string[];
}

export interface RenameState {
  path: string;
  currentName: string;
}

export function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  const lower = q.toLowerCase();
  const result: TreeNode[] = [];
  for (const node of nodes) {
    if (node.is_dir) {
      const filteredChildren = filterTree(node.children ?? [], q);
      if (filteredChildren.length > 0 || node.name.toLowerCase().includes(lower)) {
        result.push({ ...node, expanded: true, children: filteredChildren.length > 0 ? filteredChildren : node.children });
      }
    } else {
      if (node.name.toLowerCase().includes(lower)) {
        result.push(node);
      }
    }
  }
  return result;
}

export function updateNode(
  nodes: TreeNode[],
  path: string[],
  fn: (n: TreeNode) => TreeNode,
): TreeNode[] {
  const [head, ...rest] = path;
  return nodes.map((n, i) => {
    if (String(i) !== head) return n;
    if (rest.length === 0) return fn(n);
    return { ...n, children: updateNode(n.children ?? [], rest, fn) };
  });
}
