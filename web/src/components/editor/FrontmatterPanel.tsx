import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useState, useEffect, useRef } from 'react';
import { Calendar, User, Tag, Folder, Image, Video, Lock, Link as LinkIcon, FileText, Plus, X, ImageIcon, Scale, Settings2 } from 'lucide-react';
import type { ArticleFrontmatter } from '../../../../shared/types';

interface FrontmatterPanelProps {
  frontmatter: ArticleFrontmatter;
  setFm: (key: keyof ArticleFrontmatter, value: unknown) => void;
  removeArrayItem: (key: 'categories' | 'tags' | 'pictures' | 'video', index: number) => void;
  newCategory: string;
  setNewCategory: (v: string) => void;
  newTag: string;
  setNewTag: (v: string) => void;
  newPicture: string;
  setNewPicture: (v: string) => void;
  newVideo: string;
  setNewVideo: (v: string) => void;
  addItem: (key: 'categories' | 'tags' | 'pictures' | 'video') => void;
  handleInputKeyDown: (key: 'categories' | 'tags' | 'pictures' | 'video', e: ReactKeyboardEvent) => void;
}

interface CustomField {
  key: string;
  value: string;
  type: 'string' | 'number' | 'boolean';
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:00+08:00`;
}

export default function FrontmatterPanel({
  frontmatter, setFm, removeArrayItem,
  newCategory, setNewCategory, newTag, setNewTag,
  newPicture, setNewPicture, newVideo, setNewVideo,
  addItem, handleInputKeyDown
}: FrontmatterPanelProps) {
  const [customFields, setCustomFields] = useState<CustomField[]>(
    Object.entries(frontmatter.customFields ?? {}).map(([key, value]) => ({
      key,
      value: String(value ?? ''),
      type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string'
    }))
  );

  const addCustomField = () => {
    setCustomFields([...customFields, { key: '', value: '', type: 'string' }]);
  };

  const removeCustomField = (index: number) => {
    setCustomFields(customFields.filter((_, i) => i !== index));
  };

  const updateCustomField = (index: number, field: keyof CustomField, value: string) => {
    const updated = [...customFields];
    updated[index] = { ...updated[index], [field]: value };
    setCustomFields(updated);
  };

  const syncCustomFieldsToFm = () => {
    const parsed: Record<string, unknown> = {};
    for (const cf of customFields) {
      if (!cf.key.trim()) continue;
      if (cf.type === 'number') {
        parsed[cf.key.trim()] = cf.value ? parseFloat(cf.value) : undefined;
      } else if (cf.type === 'boolean') {
        parsed[cf.key.trim()] = cf.value === 'true';
      } else {
        parsed[cf.key.trim()] = cf.value;
      }
    }
    setFm('customFields', Object.keys(parsed).length > 0 ? parsed : undefined);
  };

  // Sync on mount and when customFields change
  const prevFieldsRef = useRef(JSON.stringify(customFields));
  useEffect(() => {
    if (prevFieldsRef.current !== JSON.stringify(customFields)) {
      syncCustomFieldsToFm();
      prevFieldsRef.current = JSON.stringify(customFields);
    }
  }, [customFields]);
  return (
    <div className="p-4 space-y-4">
      {/* URL / 文件名 */}
      <div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
          <FileText className="w-3 h-3" />
          URL
        </label>
        <input
          type="text"
          value={frontmatter.url || ''}
          onChange={(e) => setFm('url', e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-white text-foreground placeholder:text-muted-foreground"
          placeholder="留空则自动生成：日期-标题"
        />
      </div>

      {/* 标题 */}
      <div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
          <Folder className="w-3 h-3" />
          标题
        </label>
        <input
          type="text"
          value={frontmatter.title || ''}
          onChange={(e) => setFm('title', e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-white text-foreground placeholder:text-muted-foreground"
          placeholder="文章标题"
        />
      </div>

      {/* 日期 */}
      <div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
          <Calendar className="w-3 h-3" />
          日期
        </label>
        <input
          type="datetime-local"
          value={frontmatter.date ? (() => {
            try {
              const d = new Date(frontmatter.date);
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const day = String(d.getDate()).padStart(2, '0');
              const h = String(d.getHours()).padStart(2, '0');
              const mi = String(d.getMinutes()).padStart(2, '0');
              return `${y}-${m}-${day}T${h}:${mi}`;
            } catch {
              return '';
            }
          })() : ''}
          onChange={(e) => {
            setFm('date', e.target.value ? `${e.target.value}:00+08:00` : '');
          }}
          className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-white text-foreground"
        />
        <button
          type="button"
          onClick={() => setFm('date', formatDate(new Date()))}
          className="mt-1.5 text-xs text-primary hover:underline"
        >
          使用当前时间
        </button>
      </div>

      {/* 作者 */}
      <div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
          <User className="w-3 h-3" />
          作者
        </label>
        <input
          type="text"
          value={frontmatter.author || ''}
          onChange={(e) => setFm('author', e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-white text-foreground placeholder:text-muted-foreground"
          placeholder="作者名称"
        />
      </div>

      {/* 分类 */}
      <div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
          <Folder className="w-3 h-3" />
          分类
        </label>
        <ArrayFieldList
          items={frontmatter.categories || []}
          onRemove={(i) => removeArrayItem('categories', i)}
        />
        <div className="flex gap-1.5 mt-1.5">
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => handleInputKeyDown('categories', e)}
            className="flex-1 px-2 py-1 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-white text-foreground placeholder:text-muted-foreground"
            placeholder="输入分类后回车"
          />
          <button onClick={() => addItem('categories')} className="px-2 py-1 text-xs bg-foreground text-background rounded-sm hover:bg-foreground/90 transition-colors">添加</button>
        </div>
      </div>

      {/* 标签 */}
      <div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
          <Tag className="w-3 h-3" />
          标签
        </label>
        <ArrayFieldList
          items={frontmatter.tags || []}
          onRemove={(i) => removeArrayItem('tags', i)}
        />
        <div className="flex gap-1.5 mt-1.5">
          <input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => handleInputKeyDown('tags', e)}
            className="flex-1 px-2 py-1 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-white text-foreground placeholder:text-muted-foreground"
            placeholder="输入标签后回车"
          />
          <button onClick={() => addItem('tags')} className="px-2 py-1 text-xs bg-foreground text-background rounded-sm hover:bg-foreground/90 transition-colors">添加</button>
        </div>
      </div>

      {/* 封面图 */}
      <div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
          <ImageIcon className="w-3 h-3" />
          封面图
        </label>
        <input
          type="text"
          value={frontmatter.cover || ''}
          onChange={(e) => setFm('cover', e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-white text-foreground placeholder:text-muted-foreground"
          placeholder="封面图 URL"
        />
      </div>

      {/* 排序权重 */}
      <div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
          <Scale className="w-3 h-3" />
          权重
        </label>
        <input
          type="number"
          value={frontmatter.weight ?? ''}
          onChange={(e) => setFm('weight', e.target.value ? Number(e.target.value) : undefined)}
          className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-white text-foreground placeholder:text-muted-foreground"
          placeholder="数值越大越靠前"
        />
      </div>

      {/* 自定义字段 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Settings2 className="w-3 h-3" />
            自定义字段
          </label>
          <button
            type="button"
            onClick={addCustomField}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> 添加
          </button>
        </div>
        <div className="space-y-2">
          {customFields.map((cf, index) => (
            <div key={index} className="flex gap-1.5 items-start">
              <input
                type="text"
                value={cf.key}
                onChange={(e) => updateCustomField(index, 'key', e.target.value)}
                placeholder="键名"
                className="flex-1 px-2 py-1 text-xs border border-border rounded-sm focus:outline-none focus:border-primary bg-white text-foreground placeholder:text-muted-foreground"
              />
              <select
                value={cf.type}
                onChange={(e) => updateCustomField(index, 'type', e.target.value)}
                className="px-1.5 py-1 text-xs border border-border rounded-sm focus:outline-none focus:border-primary bg-white text-foreground"
              >
                <option value="string">文本</option>
                <option value="number">数字</option>
                <option value="boolean">布尔</option>
              </select>
              <input
                type="text"
                value={cf.value}
                onChange={(e) => updateCustomField(index, 'value', e.target.value)}
                placeholder="值"
                className="flex-1 px-2 py-1 text-xs border border-border rounded-sm focus:outline-none focus:border-primary bg-white text-foreground placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={() => removeCustomField(index)}
                className="text-xs text-muted-foreground hover:text-destructive p-1"
                aria-label="删除字段"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {customFields.length === 0 && (
            <p className="text-xs text-muted-foreground">暂无自定义字段，点击上方"添加"按钮创建</p>
          )}
        </div>
      </div>

      {/* 加密开关 */}
      <div className="flex items-center justify-between py-1">
        <span className="flex items-center gap-1.5 text-xs text-foreground">
          <Lock className="w-3 h-3 text-muted-foreground" />
          加密
        </span>
        <ToggleSwitch
          checked={!!frontmatter.encrypt}
          onCheckedChange={() => setFm('encrypt', !frontmatter.encrypt)}
        />
      </div>

      {frontmatter.encrypt && (
        <div className="space-y-2 pl-3 border-l-2 border-border">
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">密码键名</label>
            <input
              type="text"
              value={frontmatter.encryptPasswordKey || ''}
              onChange={(e) => setFm('encryptPasswordKey', e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-white text-foreground placeholder:text-muted-foreground"
              placeholder="例如 private"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">加密标题</label>
            <input
              type="text"
              value={frontmatter.encryptTitle || ''}
              onChange={(e) => setFm('encryptTitle', e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-white text-foreground placeholder:text-muted-foreground"
              placeholder="需要密码访问"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">加密消息</label>
            <textarea
              value={frontmatter.encryptMessage || ''}
              onChange={(e) => setFm('encryptMessage', e.target.value)}
              rows={2}
              className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors resize-none bg-white text-foreground placeholder:text-muted-foreground"
              placeholder="请输入密码查看内容"
            />
          </div>
        </div>
      )}

      <div className="border-t border-border" />

      {/* 图片 */}
      <div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
          <Image className="w-3 h-3" />
          图片
        </label>
        <ArrayFieldList
          items={frontmatter.pictures || []}
          onRemove={(i) => removeArrayItem('pictures', i)}
        />
        <div className="flex gap-1.5 mt-1.5">
          <input
            type="text"
            value={newPicture}
            onChange={(e) => setNewPicture(e.target.value)}
            onKeyDown={(e) => handleInputKeyDown('pictures', e)}
            className="flex-1 px-2 py-1 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-white text-foreground placeholder:text-muted-foreground"
            placeholder="图片 URL"
          />
          <button onClick={() => addItem('pictures')} className="px-2 py-1 text-xs bg-foreground text-background rounded-sm hover:bg-foreground/90 transition-colors">添加</button>
        </div>
      </div>

      {/* 视频 */}
      <div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
          <Video className="w-3 h-3" />
          视频
        </label>
        <ArrayFieldList
          items={frontmatter.video || []}
          onRemove={(i) => removeArrayItem('video', i)}
        />
        <div className="flex gap-1.5 mt-1.5">
          <input
            type="text"
            value={newVideo}
            onChange={(e) => setNewVideo(e.target.value)}
            onKeyDown={(e) => handleInputKeyDown('video', e)}
            className="flex-1 px-2 py-1 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-white text-foreground placeholder:text-muted-foreground"
            placeholder="视频 URL"
          />
          <button onClick={() => addItem('video')} className="px-2 py-1 text-xs bg-foreground text-background rounded-sm hover:bg-foreground/90 transition-colors">添加</button>
        </div>
      </div>

      <div className="border-t border-border" />

      {/* 链接 */}
      <div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
          <LinkIcon className="w-3 h-3" />
          链接
        </label>
        <input
          type="text"
          value={frontmatter.link || ''}
          onChange={(e) => setFm('link', e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-white text-foreground placeholder:text-muted-foreground mb-1.5"
          placeholder="链接 URL"
        />
        <input
          type="text"
          value={frontmatter.link_text || ''}
          onChange={(e) => setFm('link_text', e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-white text-foreground placeholder:text-muted-foreground"
          placeholder="链接文本"
        />
      </div>
    </div>
  );
}

function ArrayFieldList({ items, onRemove }: { items: string[]; onRemove: (index: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="flex-1 text-xs text-foreground bg-secondary px-2 py-1 rounded-sm border border-border truncate">{item}</span>
          <button onClick={() => onRemove(i)} className="text-xs text-muted-foreground hover:text-foreground" aria-label={`删除 ${item}`}>×</button>
        </div>
      ))}
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
      className={`w-9 h-5 rounded-full transition-colors relative ${
        checked ? 'bg-primary' : 'bg-border'
      }`}
    >
      <div
        className={`w-3.5 h-3.5 bg-background rounded-full absolute top-0.5 transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
