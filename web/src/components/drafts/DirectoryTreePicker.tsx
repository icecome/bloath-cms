// 树状目录选择器：点选回填，手打自动定位，支持新增子目录
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderPlus } from 'lucide-react';
import type { DirNode } from '../../lib/dirTree';

interface Props {
  /** 目录树根节点集合 */
  nodes: DirNode[];
  /** 当前值（完整路径） */
  value: string;
  onChange: (v: string) => void;
  /** 输入框占位提示 */
  placeholder?: string;
}

function collectPaths(nodes: DirNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    acc.push(n.path);
    collectPaths(n.children, acc);
  }
  return acc;
}

/** 判断 ancestors（含自身）链上是否命中目标路径 */
function containsPath(node: DirNode, target: string): boolean {
  if (node.path === target) return true;
  if (target.startsWith(node.path + '/')) return true;
  return false;
}

function TreeNode({
  node, value, expanded, onToggle, onSelect, creating, onCreate,
}: {
  node: DirNode;
  value: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  creating: boolean;
  onCreate: (parentPath: string, name: string) => void;
}) {
  const isOpen = expanded.has(node.path) || containsPath(node, value);
  const hasChildren = node.children.length > 0;
  const selected = value === node.path;

  return (
    <div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => hasChildren && onToggle(node.path)}
          className={`w-4 h-4 flex items-center justify-center flex-shrink-0 ${hasChildren ? 'text-muted-foreground hover:text-foreground' : 'text-transparent cursor-default'}`}
          aria-label={isOpen ? '折叠' : '展开'}
          tabIndex={hasChildren ? 0 : -1}
        >
          {hasChildren ? (isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) : <ChevronRight className="w-3 h-3" />}
        </button>
        <button
          type="button"
          onClick={() => onSelect(node.path)}
          className={`flex-1 flex items-center gap-1.5 px-1.5 py-1 text-left text-sm rounded-sm transition-colors ${
            selected ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
        >
          <Folder className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
        {creating && selected && (
          <NewSubDirInput onConfirm={(name) => onCreate(node.path, name)} />
        )}
      </div>
      {isOpen && hasChildren && (
        <div className="ml-4 border-l border-border-subtle pl-1">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              value={value}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              creating={creating}
              onCreate={onCreate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NewSubDirInput({ onConfirm }: { onConfirm: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <input
      type="text"
      value={name}
      autoFocus
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && name.trim()) onConfirm(name.trim());
      }}
      placeholder="新目录名"
      className="w-24 px-1.5 py-0.5 text-xs border border-border bg-card text-foreground placeholder-muted-foreground rounded-sm focus:outline-none focus:border-primary"
    />
  );
}

export function DirectoryTreePicker({ nodes, value, onChange, placeholder }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 手打新目录：以选中的树节点为父，此处记录父路径
  const [creating, setCreating] = useState(false);

  const allPaths = useMemo(() => collectPaths(nodes), [nodes]);
  // 手打的值若不在树中，视为新目录（允许，发布时 commit 自然创建）
  const isNewDir = value.trim() !== '' && !allPaths.includes(value);

  useEffect(() => {
    // 输入值变化时，自动展开其所在路径链；无新增时保持原引用，避免多余渲染
    setExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const p of allPaths) {
        if (value.startsWith(p + '/') && !next.has(p)) {
          next.add(p);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [value, allPaths]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const handleCreate = (parentPath: string, name: string) => {
    const clean = name.trim().replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
    if (!clean || clean.includes('..')) return;
    const next = `${parentPath}/${clean}`;
    setExpanded((prev) => new Set(prev).add(parentPath));
    setCreating(false);
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">选择目录</span>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-sm transition-colors ${
            creating ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
          title="在所选目录下新建子目录"
        >
          <FolderPlus className="w-3 h-3" />
          新建子目录
        </button>
      </div>

      <div className="max-h-48 overflow-y-auto border border-border rounded-sm p-1.5 bg-card">
        {nodes.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1 py-2">暂无可用目录，可在下方直接输入</p>
        ) : (
          nodes.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              value={value}
              expanded={expanded}
              onToggle={toggle}
              onSelect={onChange}
              creating={creating}
              onCreate={handleCreate}
            />
          ))
        )}
      </div>

      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || '如 content/posts/sub'}
        className="w-full px-2.5 py-1.5 text-sm border border-border bg-card text-foreground placeholder-muted-foreground rounded-sm focus:outline-none focus:border-primary transition-colors"
      />
      {isNewDir && (
        <p className="text-[11px] text-muted-foreground">
          该目录当前不存在，发布时会自动创建
        </p>
      )}
    </div>
  );
}
