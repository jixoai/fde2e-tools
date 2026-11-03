/**
 * 顶部栏 —— src/components/viewer/TopBar.tsx
 *
 * 全局壳件（规格）：文件名＋大小徽标、解码器 Select（含「自动」）、下载
 * （fetch→blob→a[download]）、在新窗口打开原始内容（`?raw`）、复制原始链接。
 * 图标按解码器 id 映射 lucide（业务接线层词汇，非手写 UI 组件）。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ArchiveIcon,
  AudioLinesIcon,
  BadgeCheckIcon,
  ClapperboardIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileCodeIcon,
  FileJsonIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  ImageIcon,
  PresentationIcon,
  ScrollTextIcon,
  TableIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { Badge } from '@fde2e-tools/shared/ui/badge';
import { Button } from '@fde2e-tools/shared/ui/button';
import { Separator } from '@fde2e-tools/shared/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@fde2e-tools/shared/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@fde2e-tools/shared/ui/tooltip';
import { DECODERS, type DecoderFile } from '@/decoders/registry';
import { downloadBytes } from '@/decoders/parts';
import { formatBytes } from '@/lib/format';
import { withRaw } from '@/lib/viewer-url';

/** 解码器 id → 顶栏图标（未识别 id 退 FileText）。 */
function decoderIcon(id: string) {
  switch (id) {
    case 'svg':
    case 'image':
      return ImageIcon;
    case 'video':
      return ClapperboardIcon;
    case 'audio':
      return AudioLinesIcon;
    case 'pdf':
    case 'docx':
      return FileTextIcon;
    case 'markdown':
      return FileCodeIcon;
    case 'text':
      return ScrollTextIcon;
    case 'json':
      return FileJsonIcon;
    case 'csv':
      return TableIcon;
    case 'xlsx':
      return FileSpreadsheetIcon;
    case 'pptx':
      return PresentationIcon;
    case 'zip':
      return ArchiveIcon;
    default:
      return FileTextIcon;
  }
}

export interface TopBarProps {
  file: Pick<DecoderFile, 'url' | 'name' | 'mime' | 'bytes' | 'size'>;
  /** 已解析到的解码器 id（「自动」时的命中项，供图标与提示） */
  resolvedId: string;
  /** URL 契约里的强制解码器 id（未强制为 undefined） */
  forcedId?: string;
  onSelectDecoder: (id: string | null) => void;
}

/** 复制反馈三态：成功（绿勾）/ 失败（警示＋手动复制提示）/ 静默归位。 */
type CopyState = 'idle' | 'ok' | 'fail';

/**
 * 剪贴板写入（含降级链）：async Clipboard API 在 omni 的 sandbox iframe
 * （opaque origin）嵌入形态下不存在或 writeText 直接 reject——降级
 * document.execCommand('copy')（textarea 兜底，用户手势内仍可用）。
 * 两级都失败返回 false，由调用方给「手动复制」可见提示。
 */
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒/non-secure context：落到 execCommand 兜底
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

export function ViewerTopBar({ file, resolvedId, forcedId, onSelectDecoder }: TopBarProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const Icon = decoderIcon(forcedId ?? resolvedId);
  const rawUrl = withRaw(file.url);
  // 体积：整载路径用字节长度，直连路径用 HEAD 的 Content-Length；两者皆缺 → 「—」
  const shownSize = file.size ?? (file.bytes.byteLength > 0 ? file.bytes.byteLength : null);

  // 复制反馈（成功勾选/失败警示）2.5 秒后自动归位
  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const copyLink = useCallback(async () => {
    const ok = await copyTextToClipboard(file.url);
    setCopyState(ok ? 'ok' : 'fail');
  }, [file.url]);

  return (
    <TooltipProvider>
      <header
        className="glass-panel flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b px-3"
        data-viewer-topbar="true"
        data-viewer-chrome="topbar"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        {/* 文件名保底可见（vision P1-3 残留）：right-sheet iframe 388px 时右翼
            （Select w-44＋三钮，整体 shrink-0）＋徽标把唯一可收缩的 h1 挤到宽度 0。
            修复 = 收缩优先级反转：空间不足时按「体积徽标（<480px 隐藏，信息仍在
            页脚/tooltip）→ Select 缩窄 → 极窄收分隔符」的顺序收编其它元素，
            h1 以 min-w-14 为收缩下限（ellipsis 截断，title 悬浮看全名）——任何
            宽度下文件名都不得归零。 */}
        <h1 className="min-w-14 truncate text-sm font-medium" title={file.name} data-viewer-filename="true">
          {file.name}
        </h1>
        <Badge
          variant="secondary"
          className="hidden shrink-0 font-mono text-[11px] min-[480px]:inline-flex"
        >
          {shownSize !== null ? formatBytes(shownSize) : '—'}
        </Badge>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Select
            value={forcedId ?? 'auto'}
            onValueChange={(value) => onSelectDecoder(value === 'auto' ? null : value)}
            items={selectItems(resolvedId)}
          >
            <SelectTrigger
              size="sm"
              className="w-44 min-w-0 max-w-full overflow-hidden max-[479px]:w-28 [&>span]:block [&>span]:max-w-full [&>span]:truncate"
              aria-label="解码器"
              data-decoder-select="true"
              data-decoder-value={forcedId ?? 'auto'}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {Object.entries(selectItems(resolvedId)).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Separator orientation="vertical" className="mx-1 h-5! max-[400px]:hidden" />

          {/* 三个动作钮用 outline 变体：与左侧 SelectTrigger 同族的玻璃容器面
              （vision P2：裸 ghost 图标缺容器，顶栏右翼读不成一组） */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="下载"
                  data-viewer-download="true"
                  onClick={() => downloadBytes(file.bytes, file.name, file.mime)}
                />
              }
            >
              <DownloadIcon aria-hidden />
            </TooltipTrigger>
            <TooltipContent>下载</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="在新窗口打开原始内容"
                  data-viewer-open-raw="true"
                  onClick={() => window.open(rawUrl, '_blank', 'noopener')}
                />
              }
            >
              <ExternalLinkIcon aria-hidden />
            </TooltipTrigger>
            <TooltipContent>新窗口打开原始内容（?raw）</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="复制原始链接"
                  data-viewer-copy="true"
                  data-copy-state={copyState}
                  onClick={() => void copyLink()}
                />
              }
            >
              {copyState === 'ok' ? (
                <BadgeCheckIcon className="text-success" aria-hidden />
              ) : copyState === 'fail' ? (
                <TriangleAlertIcon className="text-status-interrupted" aria-hidden />
              ) : (
                <CopyIcon aria-hidden />
              )}
            </TooltipTrigger>
            <TooltipContent>
              {copyState === 'ok'
                ? '已复制'
                : copyState === 'fail'
                  ? '复制失败——浏览器未授权剪贴板，请手动复制地址栏链接'
                  : '复制原始链接'}
            </TooltipContent>
          </Tooltip>
        </div>
      </header>
    </TooltipProvider>
  );
}

/** Select 的 items 映射（value → 显示名）。「自动」首位并标注当前命中项。 */
function selectItems(resolvedId: string): Record<string, string> {
  const hit = DECODERS.find((d) => d.id === resolvedId);
  return {
    auto: `自动${hit ? `：${hit.label}` : ''}`,
    ...Object.fromEntries(DECODERS.map((d) => [d.id, d.label])),
  };
}
