/**
 * 沙箱 iframe 容器 —— src/decoders/sandbox-frame.tsx
 *
 * html 与 svg 解码器共用的安全隔离渲染形态（规格统一预览）：
 * 字节 → 带正确 mime 的 blob URL → `sandbox=""`（禁脚本、禁同源、禁表单——
 * 全部默认拒绝）的 iframe。内嵌脚本不执行；blob URL 随组件卸载回收。
 *
 * 无壳模式（?frameless=1）：iframe 铺满内容盒、去圆角/白底（背景由根内容盒
 * 的 background 参数提供），底栏整条隐藏；iframe onLoad 即向壳层上报内容就绪。
 */
import { DecoderShell, InfoItem, useObjectUrl, downloadBytes } from '@/decoders/parts';
import type { DecoderFile } from '@/decoders/registry';
import { formatBytes } from '@/lib/format';
import { ShieldCheckIcon } from 'lucide-react';

export function SandboxFrameDecoder({
  file,
  blobMime,
  rendererLabel,
  note,
}: {
  file: DecoderFile;
  /** blob 的 Content-Type（html: text/html；svg: image/svg+xml） */
  blobMime: string;
  rendererLabel: string;
  note: string;
}) {
  const { name, mime, bytes, frameless, onContentReady } = file;
  const objectUrl = useObjectUrl(bytes, blobMime);

  return (
    <DecoderShell
      footerChrome="sandbox-footer"
      main={
        objectUrl ? (
          // 安全形态：sandbox 全默认拒绝（等价空串）——脚本永不执行。
          // 面板内边距区即内容面（P1-1：不再全幅贴边），圆角对齐壳语言。
          // 无壳：去圆角/白底，内容盒背景（background 参数）直接透出。
          <iframe
            key={objectUrl}
            src={objectUrl}
            sandbox=""
            title={name}
            className={`h-full w-full border-0 ${frameless ? '' : 'rounded-lg bg-white'}`}
            onLoad={onContentReady}
          />
        ) : null
      }
      footer={
        <>
          <span className="flex items-center gap-1 whitespace-nowrap">
            <ShieldCheckIcon className="size-3.5 text-success" aria-hidden />
            sandbox 隔离 · 脚本已禁用
          </span>
          <InfoItem label="体积" value={formatBytes(bytes.byteLength)} />
          <InfoItem label="类型" value={blobMime} />
          <span className="ml-auto truncate whitespace-nowrap opacity-80" title={note}>
            {rendererLabel} · {note}
          </span>
          <button
            type="button"
            className="shrink-0 cursor-pointer whitespace-nowrap text-xs underline underline-offset-2 hover:text-foreground"
            onClick={() => downloadBytes(bytes, name, mime)}
          >
            下载原件
          </button>
        </>
      }
    />
  );
}
