/**
 * JSON 解码器 —— src/decoders/json/index.tsx
 *
 * pretty + shiki 高亮 + 可折叠树双视图（Tabs 切换）：
 * - 树视图：自研折叠树（业务接线层；深≥2 默认收起，大数组再收一档）；
 * - 源码视图：格式化（2 空格缩进）+ 高亮。
 * 解析失败不白屏：呈解析错误态＋源码高亮视图兜底。
 */
import { useEffect, useMemo, useState } from 'react';
import { BracesIcon, ChevronDownIcon, ChevronRightIcon, ListTreeIcon } from 'lucide-react';
import { DecoderShell, InfoItem, decodeUtf8 } from '@/decoders/parts';
import type { DecoderFile } from '@/decoders/registry';
import { highlightToHtml } from '@/lib/highlight';
import { formatBytes } from '@/lib/format';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@fde2e-tools/shared/ui/tabs';

/** 折叠树的单节点（对象/数组可展开；原始值按类型着色——语法层业务样式）。 */
function TreeNode({ label, value, depth }: { label?: string; value: unknown; depth: number }) {
  const [open, setOpen] = useState(depth < 2);

  if (value === null || typeof value !== 'object') {
    return (
      <div className="flex items-start gap-1.5 py-px pl-4 font-mono text-[13px] leading-6">
        {label !== undefined ? <span className="text-syn-name">{JSON.stringify(label)}:</span> : null}
        <Primitive value={value} />
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const kind = Array.isArray(value) ? 'array' : 'object';
  const bracketOpen = kind === 'array' ? '[' : '{';
  const bracketClose = kind === 'array' ? ']' : '}';

  return (
    <div className="font-mono text-[13px] leading-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-fit cursor-pointer items-center gap-1 py-px text-left hover:text-foreground"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDownIcon className="size-3.5 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRightIcon className="size-3.5 text-muted-foreground" aria-hidden />
        )}
        {label !== undefined ? <span className="text-syn-name">{JSON.stringify(label)}:</span> : null}
        <span className="text-muted-foreground">{bracketOpen}</span>
        {!open ? (
          <span className="text-muted-foreground/70">
            {entries.length} 项{bracketClose}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="border-l pl-2 ml-3 border-border/60">
          {entries.map(([k, v]) => (
            <TreeNode key={k} label={k} value={v} depth={depth + 1} />
          ))}
        </div>
      ) : null}
      {open ? <div className="pl-4 text-muted-foreground">{bracketClose}</div> : null}
    </div>
  );
}

/** 原始值着色（字符串绿/数字橙/布尔紫——solid-glass 语法色族）。 */
function Primitive({ value }: { value: unknown }) {
  const cls =
    typeof value === 'string'
      ? 'text-syn-string'
      : typeof value === 'number'
        ? 'text-syn-number'
        : typeof value === 'boolean'
          ? 'text-syn-name'
          : 'text-muted-foreground';
  return <span className={`${cls} break-all`}>{JSON.stringify(value)}</span>;
}

export default function JsonDecoder({ name, bytes }: DecoderFile) {
  const text = useMemo(() => decodeUtf8(bytes), [bytes]);
  const parsed = useMemo<{ ok: true; value: unknown } | { ok: false; error: string }>(() => {
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'JSON 语法错误' };
    }
  }, [text]);

  const pretty = useMemo(
    () => (parsed.ok ? JSON.stringify(parsed.value, null, 2) : text),
    [parsed, text],
  );
  const [prettyHtml, setPrettyHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void highlightToHtml(pretty, 'json').then((html) => {
      if (!cancelled) setPrettyHtml(html);
    });
    return () => {
      cancelled = true;
    };
  }, [pretty]);

  const valueInfo = parsed.ok
    ? Array.isArray(parsed.value)
      ? `数组（${parsed.value.length} 项）`
      : typeof parsed.value === 'object' && parsed.value !== null
        ? `对象（${Object.keys(parsed.value).length} 键）`
        : '标量'
    : '解析失败';

  return (
    <DecoderShell
      main={
        // 文档纸面撑满面板主体（P1-1 文档类契约）
        <div className="decoder-paper h-full min-h-0 overflow-auto">
          {!parsed.ok ? (
            <div className="mx-4 mt-4 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              不是合法 JSON：{parsed.error}——按原文显示。
            </div>
          ) : null}
          {parsed.ok ? (
            <Tabs defaultValue="tree" className="flex h-full min-h-0 flex-col gap-3 p-4">
              <TabsList className="w-fit">
                <TabsTrigger value="tree">
                  <ListTreeIcon data-icon="inline-start" aria-hidden />
                  树视图
                </TabsTrigger>
                <TabsTrigger value="source">
                  <BracesIcon data-icon="inline-start" aria-hidden />
                  格式化源码
                </TabsTrigger>
              </TabsList>
              <TabsContent value="tree" className="min-h-0 flex-1 overflow-auto">
                <TreeNode value={parsed.value} depth={0} />
              </TabsContent>
              <TabsContent value="source" className="min-h-0 flex-1 overflow-auto">
                {prettyHtml ? (
                  <div className="viewer-code" dangerouslySetInnerHTML={{ __html: prettyHtml }} />
                ) : (
                  <pre className="viewer-code-plain whitespace-pre-wrap font-mono text-[13px] leading-relaxed">
                    {pretty}
                  </pre>
                )}
              </TabsContent>
            </Tabs>
          ) : prettyHtml ? (
            <div className="viewer-code m-4" dangerouslySetInnerHTML={{ __html: prettyHtml }} />
          ) : (
            <pre className="viewer-code-plain m-4 whitespace-pre-wrap font-mono text-[13px] leading-relaxed">
              {text}
            </pre>
          )}
        </div>
      }
      footer={
        <>
          <InfoItem label="结构" value={valueInfo} />
          <InfoItem label="行数" value={pretty.split('\n').length.toLocaleString('zh-CN')} />
          <InfoItem label="大小" value={formatBytes(bytes.byteLength)} />
          <span className="ml-auto whitespace-nowrap">{name}</span>
        </>
      }
    />
  );
}
