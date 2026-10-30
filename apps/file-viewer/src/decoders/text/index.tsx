/**
 * 文本解码器（兜底）—— src/decoders/text/index.tsx
 *
 * 全站兜底：未知/未支持格式一律先进这里。职责：
 * 1. 二进制嗅探（looksBinary）——命中则呈「未支持格式＋下载」态，绝不渲染乱码；
 * 2. 编码切换：auto（jschardet 探测）/UTF-8/GBK/Big5/Shift_JIS/Latin-1；
 * 3. shiki 高亮（按扩展名选语言，未知 → text 纯文本；内容 >64KB 走尺寸门降级
 *    纯 <pre>——shiki token span 随字符数爆炸，大文件高亮会卡死主线程）；
 * 4. >1MB 截断提示（可下载全文）；底部信息：编码/行数/文件大小＋高亮关断诚实标注。
 */
import { useEffect, useMemo, useState } from 'react';
import jschardet from 'jschardet';
import { TriangleAlertIcon, ZapOffIcon } from 'lucide-react';
import { DecoderShell, InfoItem, UnsupportedState, downloadBytes } from '@/decoders/parts';
import type { DecoderFile } from '@/decoders/registry';
import { looksBinary } from '@/lib/sniff';
import { highlightToHtml, langForFile } from '@/lib/highlight';
import { textPreviewPath } from '@/lib/preview-gate';
import { formatBytes } from '@/lib/format';
import { Button } from '@fde2e-tools/shared/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@fde2e-tools/shared/ui/select';

/** 截断阈值：1MB（规格）。超过只解码前 1MB，横幅提示＋下载全文出路。 */
const TRUNCATE_BYTES = 1_000_000;

/** 编码清单（TextDecoder label；auto = jschardet 探测）。 */
const ENCODINGS = [
  { id: 'auto', label: '自动检测' },
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'gbk', label: 'GBK' },
  { id: 'big5', label: 'Big5' },
  { id: 'shift_jis', label: 'Shift_JIS' },
  { id: 'latin1', label: 'Latin-1' },
] as const;

type EncodingId = (typeof ENCODINGS)[number]['id'];

/** jschardet 编码名 → 本站 TextDecoder label（认不出的返回 null＝无候选）。 */
function mapJschardet(name: string | undefined | null): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n === 'gb18030') return 'gb18030'; // TextDecoder 原生支持 gb18030 label
  if (n.includes('gb')) return 'gbk';
  if (n.includes('big5')) return 'big5';
  if (n.includes('shift') || n === 'sjis' || n.includes('cp932')) return 'shift_jis';
  if (n.includes('1252') || n.includes('8859-1') || n === 'latin1' || n.includes('iso-8859')) return 'latin1';
  if (n.includes('utf-8') || n === 'ascii' || n.includes('windows-1252')) return 'utf-8';
  return null;
}

/** U+FFFD（替换字符）计数——解码质量的自校验指标（越少越好）。 */
function countReplacementChars(text: string): number {
  let count = 0;
  for (const ch of text) if (ch === '\uFFFD') count += 1;
  return count;
}

function decodeWith(bytes: Uint8Array, encoding: string): string {
  let text: string;
  try {
    text = new TextDecoder(encoding).decode(bytes);
  } catch {
    text = new TextDecoder('utf-8').decode(bytes);
  }
  // 剥首部 BOM（utf-8 解码保留 \uFEFF 字符）
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export default function TextFileDecoder({ name, mime, bytes }: DecoderFile) {
  // 兜底安全闸：二进制内容不渲染乱码
  const binary = useMemo(() => looksBinary(bytes), [bytes]);

  const [encoding, setEncoding] = useState<EncodingId>('auto');
  const [autoEncoding, setAutoEncoding] = useState<Exclude<EncodingId, 'auto'> | null>(null);
  const [rendered, setRendered] = useState<string | null>(null);

  const truncated = bytes.byteLength > TRUNCATE_BYTES;
  const working = useMemo(
    () => (truncated ? bytes.subarray(0, TRUNCATE_BYTES) : bytes),
    [bytes, truncated],
  );

  // auto：jschardet 探测候选 × 替换字符自校验（谁的解码结果更干净谁上）。
  // 短文本上 jschardet 置信度普遍偏低（GBK 短样例实测 0.17），所以不以置信度
  // 硬门槛拒绝，而是：候选解码的 U+FFFD 计数严格少于 UTF-8 直解时才采纳——
  // 真正的 UTF-8 文件零替换字符，任何误判候选都赢不了它。
  useEffect(() => {
    if (binary) return;
    const utf8Text = decodeWith(working, 'utf-8');
    const utf8Bad = countReplacementChars(utf8Text);
    let chosen: string = 'utf-8';
    try {
      const detected = jschardet.detect(working);
      if (detected?.encoding && typeof detected.confidence === 'number' && detected.confidence >= 0.05) {
        const label = mapJschardet(detected.encoding);
        if (label && label !== 'utf-8') {
          const candidate = decodeWith(working, label);
          if (countReplacementChars(candidate) < utf8Bad) chosen = label;
        }
      }
    } catch {
      // 探测失败按 UTF-8 兜底
    }
    setAutoEncoding(chosen as Exclude<EncodingId, 'auto'>);
  }, [binary, working]);

  const effective = encoding === 'auto' ? (autoEncoding ?? 'utf-8') : encoding;
  const text = useMemo(() => (binary ? '' : decodeWith(working, effective)), [binary, working, effective]);

  // 尺寸门：≤64KB 才走 shiki（token span 成本与字符数同阶，大文件直接零 token 化）
  const previewPath = textPreviewPath(text.length);

  // 高亮（门内走 shiki；门外纯 pre 快路径，主线程零阻塞）
  useEffect(() => {
    if (binary || previewPath === 'plain') {
      setRendered(null);
      return;
    }
    let cancelled = false;
    void highlightToHtml(text, langForFile(name)).then((html) => {
      if (!cancelled) setRendered(html);
    });
    return () => {
      cancelled = true;
    };
  }, [binary, previewPath, text, name]);

  if (binary) {
    return <UnsupportedState name={name} mime={mime} onDownload={() => downloadBytes(bytes, name, mime)} />;
  }

  const lines = text.length === 0 ? 0 : text.split('\n').length;

  return (
    <DecoderShell
      main={
        // 文档纸面撑满面板主体（P1-1 文档类契约；纸面色 = .decoder-paper）
        <div className="decoder-paper h-full min-h-0 overflow-auto">
          {truncated ? (
            <div className="mx-4 mt-4 flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <TriangleAlertIcon className="size-3.5" aria-hidden />
                文件超过 1MB，已截断显示——其余内容请下载全文查看
              </span>
              <Button variant="ghost" size="xs" onClick={() => downloadBytes(bytes, name, mime)}>
                下载全文
              </Button>
            </div>
          ) : null}
          {rendered ? (
            <div className="viewer-code viewer-prose p-4" dangerouslySetInnerHTML={{ __html: rendered }} />
          ) : (
            <pre className="viewer-code-plain m-4 font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words">
              {text}
            </pre>
          )}
        </div>
      }
      footer={
        <>
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="opacity-70">编码</span>
            <Select
              value={encoding}
              onValueChange={(v) => setEncoding(v as EncodingId)}
              items={Object.fromEntries(ENCODINGS.map((e) => [e.id, e.label]))}
            >
              <SelectTrigger size="sm" className="h-6 w-32 text-xs" aria-label="文本编码">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {ENCODINGS.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {encoding === 'auto' ? (
              <span className="whitespace-nowrap opacity-70">（探测：{effective}）</span>
            ) : null}
          </span>
          <InfoItem label="行数" value={lines.toLocaleString('zh-CN')} />
          <InfoItem label="大小" value={formatBytes(bytes.byteLength)} />
          {/* 尺寸门诚实呈现：关了高亮就明说，不谎报渲染形态 */}
          {previewPath === 'plain' ? (
            <span className="ml-auto flex items-center gap-1 whitespace-nowrap">
              <ZapOffIcon className="size-3.5" aria-hidden />
              大文件已关闭高亮
            </span>
          ) : null}
        </>
      }
    />
  );
}
