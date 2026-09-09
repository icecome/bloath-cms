// Schema 驱动文章配置面板：按 Profile 的 FieldConfig 分组渲染
// 未在 schema 中的既有 front-matter 字段不做展示但原样保留，保存时不丢失
import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import {
  ChevronDown, ChevronRight, X, CalendarClock, ImageIcon, PlusCircle, Settings2
} from 'lucide-react';
import type { FieldConfig, FieldGroup } from '../../../../shared/types';
import type { SiteProfile } from '../../../../shared/profiles';
import type { Frontmatter } from '../../lib/frontmatter';
import MediaPickerDialog from './MediaPickerDialog';

interface SchemaFormPanelProps {
  frontmatter: Frontmatter;
  setFm: (key: keyof Frontmatter, value: unknown) => void;
  profile: SiteProfile;
}

const GROUP_ORDER: FieldGroup[] = ['basic', 'advanced', 'seo', 'custom'];
const GROUP_LABELS: Record<FieldGroup, string> = {
  basic: '基础信息',
  advanced: '高级选项',
  seo: 'SEO',
  custom: '自定义'
};

// 禁止作为自定义字段键名的危险属性，防止原型链污染
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function fieldHasValue(fm: Frontmatter, field: FieldConfig): boolean {
  const value = (fm as Record<string, unknown>)[field.name];
  if (field.type === 'boolean') return value === true;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
}

// 本地时区偏移（如 +08:00 / -05:30），替代硬编码 UTC+8
function localTimezoneOffset(date: Date): string {
  const diffMin = -date.getTimezoneOffset();
  const sign = diffMin >= 0 ? '+' : '-';
  const abs = Math.abs(diffMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:00${localTimezoneOffset(date)}`;
}

function toDatetimeInputValue(value: unknown): string {
  if (!value) return '';
  try {
    const d = new Date(value as string);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}:${mi}`;
  } catch {
    return '';
  }
}

export default function SchemaFormPanel({ frontmatter, setFm, profile }: SchemaFormPanelProps) {
  // 初始折叠状态：基础组始终展开，其余组含有效值才展开
  const [openGroups, setOpenGroups] = useState<Record<FieldGroup, boolean>>(() => {
    const state = { basic: true, advanced: false, seo: false, custom: false } as Record<FieldGroup, boolean>;
    for (const group of GROUP_ORDER) {
      if (group === 'basic') continue;
      if (profile.fields.some((f) => f.group === group && fieldHasValue(frontmatter, f))) {
        state[group] = true;
      }
    }
    return state;
  });

  const toggleGroup = (group: FieldGroup) => {
    setOpenGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const grouped = useMemo(() => {
    const map = new Map<FieldGroup, FieldConfig[]>();
    for (const f of profile.fields) {
      const group = f.group ?? 'basic';
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(f);
    }
    return map;
  }, [profile]);

  return (
    <div className="p-4 space-y-3">
      {GROUP_ORDER.map((group) => {
        const fields = grouped.get(group);
        if (!fields || fields.length === 0) return null;
        const open = openGroups[group];
        return (
          <div key={group} className="space-y-3">
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              className="w-full flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {GROUP_LABELS[group]}
            </button>
            {open && (
              <div className="space-y-4">
                {fields.map((f) => (
                  <SchemaField key={f.name} field={f} frontmatter={frontmatter} setFm={setFm} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-[10px] text-muted-foreground border-t border-border pt-2">
        当前站点：{profile.label} · 表单未覆盖的已有字段会原样保留
      </p>
    </div>
  );
}

function SchemaField({
  field, frontmatter, setFm
}: {
  field: FieldConfig;
  frontmatter: Frontmatter;
  setFm: (key: keyof Frontmatter, value: unknown) => void;
}) {
  const rawValue = (frontmatter as Record<string, unknown>)[field.name];
  const setValue = (value: unknown) => setFm(field.name as keyof Frontmatter, value);

  switch (field.type) {
    case 'slug':
      return (
        <FieldShell field={field}>
          <input
            type="text"
            value={typeof rawValue === 'string' ? rawValue : ''}
            onChange={(e) => setValue(e.target.value)}
            className={inputClass}
            placeholder={field.placeholder}
          />
        </FieldShell>
      );

    case 'string':
    case 'url':
      return (
        <FieldShell field={field}>
          <input
            type="text"
            value={typeof rawValue === 'string' ? rawValue : ''}
            onChange={(e) => setValue(e.target.value)}
            className={inputClass}
            placeholder={field.placeholder}
          />
        </FieldShell>
      );

    case 'text':
      return (
        <FieldShell field={field}>
          <textarea
            value={typeof rawValue === 'string' ? rawValue : ''}
            onChange={(e) => setValue(e.target.value)}
            rows={2}
            className={`${inputClass} resize-none`}
            placeholder={field.placeholder}
          />
        </FieldShell>
      );

    case 'number':
      return (
        <FieldShell field={field}>
          <input
            type="number"
            value={typeof rawValue === 'number' ? rawValue : ''}
            onChange={(e) => setValue(e.target.value ? Number(e.target.value) : undefined)}
            className={inputClass}
            placeholder={field.placeholder}
          />
        </FieldShell>
      );

    case 'boolean':
      return (
        <div className="flex items-center justify-between py-1">
          <span className="text-xs text-foreground">{field.label}</span>
          <ToggleSwitch
            checked={rawValue === true}
            onCheckedChange={() => setValue(rawValue !== true)}
          />
        </div>
      );

    case 'datetime':
      return (
        <FieldShell field={field}>
          <input
            type="datetime-local"
            value={toDatetimeInputValue(rawValue)}
            onChange={(e) => setValue(e.target.value ? `${e.target.value}:00${localTimezoneOffset(new Date())}` : undefined)}
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => setValue(formatDate(new Date()))}
            className="mt-1.5 text-xs text-primary hover:underline flex items-center gap-1"
          >
            <CalendarClock className="w-3 h-3" />
            使用当前时间
          </button>
        </FieldShell>
      );

    case 'select':
      return (
        <FieldShell field={field}>
          <select
            value={typeof rawValue === 'string' ? rawValue : ''}
            onChange={(e) => setValue(e.target.value || undefined)}
            className={`${inputClass} bg-white`}
          >
            <option value="">（未设置）</option>
            {(field.options ?? []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </FieldShell>
      );

    case 'multiselect':
      return (
        <FieldShell field={field}>
          <TagListField
            items={Array.isArray(rawValue) ? rawValue.map(String) : []}
            placeholder={field.placeholder}
            onAdd={(item) => setValue([...(Array.isArray(rawValue) ? rawValue : []), item])}
            onRemove={(index) => {
              const list = Array.isArray(rawValue) ? [...rawValue] : [];
              list.splice(index, 1);
              setValue(list);
            }}
          />
        </FieldShell>
      );

    case 'image':
      return <ImageFieldShell field={field} value={typeof rawValue === 'string' ? rawValue : ''} onChange={setValue} />;

    case 'image-list':
      return (
        <ImageListField
          field={field}
          items={Array.isArray(rawValue) ? rawValue.map(String) : []}
          onAdd={(item) => setValue([...(Array.isArray(rawValue) ? rawValue : []), item])}
          onRemove={(index) => {
            const list = Array.isArray(rawValue) ? [...rawValue] : [];
            list.splice(index, 1);
            setValue(list);
          }}
        />
      );

    case 'string-list':
      return (
        <FieldShell field={field}>
          <TagListField
            items={Array.isArray(rawValue) ? rawValue.map(String) : []}
            placeholder={field.placeholder}
            onAdd={(item) => setValue([...(Array.isArray(rawValue) ? rawValue : []), item])}
            onRemove={(index) => {
              const list = Array.isArray(rawValue) ? [...rawValue] : [];
              list.splice(index, 1);
              setValue(list);
            }}
          />
        </FieldShell>
      );

    case 'custom-fields':
      return <CustomFieldsField frontmatter={frontmatter} setFm={setFm} />;

    default:
      return null;
  }
}

const inputClass = 'w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-white text-foreground placeholder:text-muted-foreground';

function FieldShell({ field, children }: { field: FieldConfig; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1.5">{field.label}</label>
      {children}
    </div>
  );
}

function ToggleSwitch({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onCheckedChange}
      className={`w-9 h-5 rounded-full transition-colors relative ${checked ? 'bg-primary' : 'bg-border'}`}
    >
      <div
        className={`w-3.5 h-3.5 bg-background rounded-full absolute top-0.5 transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function TagListField({
  items, placeholder, onAdd, onRemove
}: {
  items: string[];
  placeholder?: string;
  onAdd: (item: string) => void;
  onRemove: (index: number) => void;
}) {
  const [input, setInput] = useState('');

  const add = () => {
    const value = input.trim();
    if (!value) return;
    if (items.includes(value)) {
      setInput('');
      return;
    }
    onAdd(value);
    setInput('');
  };

  return (
    <>
      <ArrayChipList items={items} onRemove={onRemove} />
      <div className="flex gap-1.5 mt-1.5">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          className="flex-1 px-2 py-1 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-white text-foreground placeholder:text-muted-foreground"
          placeholder={placeholder}
        />
        <button onClick={add} className="px-2 py-1 text-xs bg-foreground text-background rounded-sm hover:bg-foreground/90 transition-colors">添加</button>
      </div>
    </>
  );
}

function ArrayChipList({ items, onRemove }: { items: string[]; onRemove: (index: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={`${item}-${i}`} className="flex items-center gap-1">
          <span className="flex-1 text-xs text-foreground bg-secondary px-2 py-1 rounded-sm border border-border truncate">{item}</span>
          <button onClick={() => onRemove(i)} className="text-xs text-muted-foreground hover:text-foreground" aria-label={`删除 ${item}`}>×</button>
        </div>
      ))}
    </div>
  );
}

function ImageFieldShell({
  field, value, onChange
}: {
  field: FieldConfig;
  value: string;
  onChange: (value: unknown) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <FieldShell field={field}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
        placeholder={field.placeholder}
      />
      <div className="flex items-center gap-2 mt-1.5">
        {value && (
          <img src={value} alt={field.label} className="w-8 h-8 object-cover rounded-sm border border-border" loading="lazy" />
        )}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <ImageIcon className="w-3 h-3" />
          从媒体库选择
        </button>
      </div>
      <MediaPickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(url) => onChange(url)} />
    </FieldShell>
  );
}

function ImageListField({
  field, items, onAdd, onRemove
}: {
  field: FieldConfig;
  items: string[];
  onAdd: (item: string) => void;
  onRemove: (index: number) => void;
}) {
  const [input, setInput] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const add = () => {
    const value = input.trim();
    if (!value) return;
    if (items.includes(value)) {
      setInput('');
      return;
    }
    onAdd(value);
    setInput('');
  };

  return (
    <FieldShell field={field}>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={`${item}-${i}`} className="flex items-center gap-1">
            <img src={item} alt="" className="w-6 h-6 object-cover rounded-sm border border-border flex-shrink-0" loading="lazy" />
            <span className="flex-1 text-xs text-foreground bg-secondary px-2 py-1 rounded-sm border border-border truncate">{item}</span>
            <button onClick={() => onRemove(i)} className="text-xs text-muted-foreground hover:text-foreground" aria-label={`删除 ${item}`}>×</button>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          className="flex-1 px-2 py-1 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-white text-foreground placeholder:text-muted-foreground"
          placeholder={field.placeholder}
        />
        <button onClick={add} className="px-2 py-1 text-xs bg-foreground text-background rounded-sm hover:bg-foreground/90 transition-colors">添加</button>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="px-2 py-1 text-xs text-primary border border-border rounded-sm hover:bg-accent transition-colors"
          aria-label="从媒体库选择"
        >
          <ImageIcon className="w-3 h-3" />
        </button>
      </div>
      <MediaPickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={onAdd} />
    </FieldShell>
  );
}

// ---------- 自定义字段（key/value 编辑，保留未触碰字段的原始值） ----------

interface CustomFieldRow {
  /** 稳定行 id，作为渲染 key，避免删除中间行时输入焦点错乱 */
  id: number;
  key: string;
  value: string;
  type: 'string' | 'number' | 'boolean';
  /** 同步时的原始值；未编辑过的行在写回时原样保留（防止嵌套对象被字符串化） */
  raw?: unknown;
  dirty: boolean;
}

let nextFieldRowId = 0;
function makeFieldRowId(): number {
  nextFieldRowId += 1;
  return nextFieldRowId;
}

function rowFromValue(key: string, value: unknown): CustomFieldRow {
  return {
    id: makeFieldRowId(),
    key,
    value: value === undefined || value === null ? '' : String(value),
    type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string',
    raw: value,
    dirty: false
  };
}

function CustomFieldsField({ frontmatter, setFm }: {
  frontmatter: Frontmatter;
  setFm: (key: keyof Frontmatter, value: unknown) => void;
}) {
  const [rows, setRows] = useState<CustomFieldRow[]>([]);
  const syncedPropJsonRef = useRef(JSON.stringify(frontmatter.customFields ?? {}));

  // 父组件 prop 外部变更（如切换文章）时，重新初始化本地状态
  useEffect(() => {
    const propJson = JSON.stringify(frontmatter.customFields ?? {});
    if (syncedPropJsonRef.current === propJson) return;
    syncedPropJsonRef.current = propJson;
    const custom = (frontmatter.customFields ?? {}) as Record<string, unknown>;
    setRows(Object.entries(custom).map(([key, value]) => rowFromValue(key, value)));
  }, [frontmatter.customFields]);

  // 首次挂载时初始化（prop effect 不覆盖首帧）
  useEffect(() => {
    const custom = (frontmatter.customFields ?? {}) as Record<string, unknown>;
    setRows(Object.entries(custom).map(([key, value]) => rowFromValue(key, value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = (updated: CustomFieldRow[]) => {
    const parsed: Record<string, unknown> = {};
    for (const row of updated) {
      const key = row.key.trim();
      if (!key || FORBIDDEN_KEYS.has(key)) continue;
      if (row.dirty || row.raw === undefined) {
        if (row.type === 'number') {
          parsed[key] = row.value !== '' ? parseFloat(row.value) : undefined;
        } else if (row.type === 'boolean') {
          parsed[key] = row.value === 'true';
        } else {
          parsed[key] = row.value;
        }
      } else {
        parsed[key] = row.raw;
      }
    }
    const hasKeys = Object.keys(parsed).length > 0;
    setFm('customFields', hasKeys ? parsed : undefined);
    syncedPropJsonRef.current = JSON.stringify(hasKeys ? parsed : {});
  };

  const update = (index: number, patch: Partial<CustomFieldRow>) => {
    const next = [...rows];
    const target = next[index];
    if (target) next[index] = { ...target, ...patch, dirty: true };
    setRows(next);
    emit(next);
  };

  const addRow = () => {
    setRows([...rows, { id: makeFieldRowId(), key: '', value: '', type: 'string', dirty: true }]);
  };

  const removeRow = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    setRows(next);
    emit(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <Settings2 className="w-3 h-3" />
          自定义字段
        </label>
        <button type="button" onClick={addRow} className="text-xs text-primary hover:underline flex items-center gap-1">
          <PlusCircle className="w-3 h-3" /> 添加
        </button>
      </div>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.id} className="space-y-1.5">
            <div className="flex gap-1.5 items-center">
              <input
                type="text"
                value={row.key}
                onChange={(e) => update(index, { key: e.target.value })}
                placeholder="键名"
                className="flex-1 px-2 py-1 text-xs border border-border rounded-sm focus:outline-none focus:border-primary bg-white text-foreground placeholder:text-muted-foreground"
              />
              <select
                value={row.type}
                onChange={(e) => update(index, { type: e.target.value as CustomFieldRow['type'] })}
                className="w-[72px] px-1.5 py-1 text-xs border border-border rounded-sm focus:outline-none focus:border-primary bg-white text-foreground"
              >
                <option value="string">文本</option>
                <option value="number">数字</option>
                <option value="boolean">布尔</option>
              </select>
              <button
                type="button"
                onClick={() => removeRow(index)}
                className="text-xs text-muted-foreground hover:text-destructive p-1"
                aria-label="删除字段"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            {row.type === 'boolean' ? (
              <select
                value={row.value}
                onChange={(e) => update(index, { value: e.target.value })}
                className="w-full px-2 py-1 text-xs border border-border rounded-sm focus:outline-none focus:border-primary bg-white text-foreground"
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                type={row.type === 'number' ? 'number' : 'text'}
                value={row.value}
                onChange={(e) => update(index, { value: e.target.value })}
                placeholder="值"
                className="w-full px-2 py-1 text-xs border border-border rounded-sm focus:outline-none focus:border-primary bg-white text-foreground placeholder:text-muted-foreground"
              />
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground">暂无自定义字段，点击上方"添加"按钮创建</p>
        )}
      </div>
    </div>
  );
}
