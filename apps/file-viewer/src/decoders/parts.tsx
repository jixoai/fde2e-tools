/**
 * 解码器共享部件 —— src/decoders/parts.tsx
 *
 * 业务接线层（非 shadcn 底座件的组合层，按纪律允许）：
 * - DecoderShell：解码器的全高布局（主区 + 自治底部栏）——布局壳只留 slot；
 * - InfoItem / ToolButton：底部栏的信息项与工具钮词汇；
 * - UnsupportedState：二进制嗅探命中后的「未支持格式＋下载」态；
 * - DecoderErrorState：解码器内部渲染失败的降级态（如 pptx 解析失败→下载）；
 * - useObjectUrl / downloadBytes / decodeUtf8：字节↔blob↔文本的共用小件。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { DownloadIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { Button } from '@fde2e-tools/shared/ui/button';

/**
 * 解码器全高布局：主区（min-h-0 可滚动）+ 自治底部栏 + 浮层 children（zip 内嵌预览用）。
 *
 * 单一内容表面契约（vision P1-1 收口）：所有解码器主体统一落进同一块玻璃面板
 * （圆角描边、面板级 blur/rim/hairline，对齐顶栏/底栏的壳语言），面板统一内边距
 * 16px——各解码器不再自带白卡/灰底/全幅贴边等各异的容器形态。
 */
export function DecoderShell({
  main,
  footer,
  children,
}: {
  main: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 p-4 max-sm:p-0">
        <div
          className="glass-panel h-full min-h-0 overflow-hidden rounded-xl max-sm:rounded-none"
          data-decoder-surface="true"
        >
          {main}
        </div>
      </div>
      {children}
      {footer ? (
        <footer className="glass-panel flex h-10 shrink-0 items-center gap-4 border-t px-3 text-xs text-muted-foreground">
          {footer}
        </footer>
      ) : null}
    </div>
  );
}

/** 底部栏信息项（label + value）。 */
export function InfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="opacity-70">{label}</span>
      <span className="font-medium text-foreground/90">{value}</span>
    </span>
  );
}

/** 底部栏工具钮（幽灵小号）。 */
export function ToolButton({
  onClick,
  title,
  active,
  children,
}: {
  onClick?: () => void;
  title: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className={active ? 'bg-secondary text-foreground' : undefined}
      aria-pressed={active}
      title={title}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** 「未支持格式＋下载」态：文本兜底路径嗅探命中二进制时呈现（不渲染乱码）。 */
export function UnsupportedState({
  name,
  mime,
  onDownload,
}: {
  name: string;
  mime?: string;
  onDownload: () => void;
}) {
  return (
    <DecoderShell
      main={
        <div className="h-full overflow-y-auto" data-viewer-error="true" data-viewer-error-kind="unsupported-binary">
        <div className="flex min-h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="glass-control flex size-16 items-center justify-center rounded-2xl">
            <TriangleAlertIcon className="size-7 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1.5">
            <p className="font-medium">未支持的二进制格式</p>
            {/* 列宽放宽 + text-pretty：长文件名/长说明不再挤成窄条（vision s10） */}
            <p className="max-w-lg text-pretty text-sm text-muted-foreground">
              {escapeName(name)} 的内容是二进制数据，站内暂无对应解码器
              {mime ? `（Content-Type：${mime}）` : ''}。可下载后用专业工具打开。
            </p>
          </div>
          <Button variant="outline" onClick={onDownload}>
            <DownloadIcon data-icon="inline-start" aria-hidden />
            下载文件
          </Button>
        </div>
        </div>
      }
    />
  );
}

/** 解码器内部失败态：尽力渲染失败后的降级（附下载出路，禁白屏）。 */
export function DecoderErrorState({
  title,
  detail,
  onDownload,
}: {
  title: string;
  detail?: string;
  onDownload: () => void;
}) {
  return (
    <DecoderShell
      main={
        <div className="h-full overflow-y-auto" data-viewer-error="true" data-viewer-error-kind="decoder-failed">
        <div className="flex min-h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="glass-control flex size-16 items-center justify-center rounded-2xl">
            <TriangleAlertIcon className="size-7 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1.5">
            <p className="font-medium">{title}</p>
            {detail ? <p className="max-w-lg text-pretty text-sm text-muted-foreground">{detail}</p> : null}
          </div>
          <Button variant="outline" onClick={onDownload}>
            <DownloadIcon data-icon="inline-start" aria-hidden />
            下载文件
          </Button>
        </div>
        </div>
      }
    />
  );
}

/** 解码器内部加载态（shiki/docx/pptx 等异步初始化期间）。 */
export function DecoderLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

/** 字节 → blob URL 的生命周期挂钩（组件卸载即回收）。 */
export function useObjectUrl(bytes: Uint8Array, mime: string): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(bytesToBlob(bytes, mime));
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [bytes, mime]);
  return objectUrl;
}

/** 触发浏览器下载（fetch→blob→a[download] 的字节版）。 */
export function downloadBytes(bytes: Uint8Array, name: string, mime?: string): void {
  const url = URL.createObjectURL(bytesToBlob(bytes, mime));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * 字节 → Blob。TS 的 BlobPart 只收 ArrayBuffer 背书的视图（SharedArrayBuffer
 * 被类型层拒绝）——本站字节恒来自 fetch/unzip 的独立 ArrayBuffer，整段引用时
 * 零拷贝；仅在对 buffer 做过 subarray（截断）时按范围切片（slice 复制一次）。
 */
function bytesToBlob(bytes: Uint8Array, mime?: string): Blob {
  const source = bytes.buffer as ArrayBuffer; // 运行时永不 SharedArrayBuffer（见上注）
  const part =
    bytes.byteOffset === 0 && bytes.byteLength === source.byteLength
      ? source
      : source.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Blob([part], { type: mime || 'application/octet-stream' });
}

/** 字节 → 独立 ArrayBuffer（pptx-preview 等 API 要求 ArrayBuffer 形参）。 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return (bytes.buffer as ArrayBuffer).slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}

/** UTF-8 解码 + 剥首部 BOM（omni csv 落盘带 BOM，读回统一在此剥）。 */
export function decodeUtf8(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** 文件名过长时截中段展示（顶栏/错误态共用）。 */
function escapeName(name: string): string {
  return name.length > 64 ? `${name.slice(0, 40)}…${name.slice(-20)}` : name;
}
