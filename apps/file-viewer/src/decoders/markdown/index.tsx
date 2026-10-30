/**
 * Markdown 解码器 —— src/decoders/markdown/index.tsx
 *
 * 管线（marked → shiki 后处理 → DOMPurify 消毒）：
 * 1. marked（GFM）先产出转义安全的 HTML（代码块仍是转义文本）；
 * 2. DOMParser 找出 `pre > code.language-*` 代码块，逐块交给 shiki 高亮
 *    （整块 <pre> 替换，双主题 CSS 变量），替换发生在一个游离的 parsed 文档里；
 * 3. 整篇过 DOMPurify 再进 dangerouslySetInnerHTML——消毒是硬闸（白名单标签/
 *    属性，脚本/事件处理器/危险协议全部剥离），不是「信任 marked 的转义」。
 * 底部信息：行数/字符数/体积＋消毒标识。
 */
import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { ShieldCheckIcon } from 'lucide-react';
import { DecoderShell, DecoderLoading, InfoItem, decodeUtf8 } from '@/decoders/parts';
import type { DecoderFile } from '@/decoders/registry';
import { highlightToHtml } from '@/lib/highlight';
import { formatBytes } from '@/lib/format';

/** marked 实例：GFM 表格/任务列表；代码块保持默认转义（高亮在后处理补）。 */
const marked = new Marked({ gfm: true });

/**
 * DOMPurify 消毒：html 白名单 + 放行 shiki 双主题所需 style 属性。
 * FORBID script/iframe/form/style——恶意 markdown 的注入面全部收死。
 */
function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['style'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'form'],
  });
}

/** 代码块后处理：在游离文档里把 `pre > code.language-*` 替换为 shiki 整块产物。 */
async function highlightCodeBlocks(rawHtml: string): Promise<string> {
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  const blocks = Array.from(doc.querySelectorAll('pre > code[class*="language-"]'));
  await Promise.all(
    blocks.map(async (el) => {
      const langId = el.className.match(/language-([\w+#.-]+)/)?.[1] ?? 'text';
      const html = await highlightToHtml(el.textContent ?? '', langId);
      const pre = el.parentElement;
      if (pre) pre.outerHTML = html; // 整块 <pre> 级替换（shiki 产物自带 pre）
    }),
  );
  return doc.body.innerHTML;
}

export default function MarkdownDecoder({ bytes }: DecoderFile) {
  const text = useMemo(() => decodeUtf8(bytes), [bytes]);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const raw = await marked.parse(text);
      const withHighlight = await highlightCodeBlocks(typeof raw === 'string' ? raw : '');
      const clean = sanitize(withHighlight);
      if (!cancelled) setHtml(clean);
    })();
    return () => {
      cancelled = true;
    };
  }, [text]);

  return (
    <DecoderShell
      main={
        html === null ? (
          <DecoderLoading label="渲染中…" />
        ) : (
          // 唯一 innerHTML 注入点，内容必经 sanitize()——安全红线锚在此处。
          // 文档纸面撑满面板主体（P1-1 文档类契约），文字列居中限宽；
          // viewer-code 类是 shiki 代码块容器/着色规则的挂载点（P1-8，缺它整块无容器无色）。
          <div className="decoder-paper h-full min-h-0 overflow-auto">
            <article className="viewer-prose viewer-code mx-auto max-w-4xl px-8 py-6">
              <div dangerouslySetInnerHTML={{ __html: html }} />
            </article>
          </div>
        )
      }
      footer={
        <>
          <InfoItem label="行数" value={text.length === 0 ? 0 : text.split('\n').length} />
          <InfoItem label="字符数" value={text.length.toLocaleString('zh-CN')} />
          <InfoItem label="体积" value={formatBytes(bytes.byteLength)} />
          {/* 对外品牌纪律：页脚只描述能力，不外露内部实现名（P1-7 同族收口） */}
          <span className="ml-auto flex items-center gap-1 whitespace-nowrap">
            <ShieldCheckIcon className="size-3.5 text-success" aria-hidden />
            已消毒 · 代码块高亮
          </span>
        </>
      }
    />
  );
}
