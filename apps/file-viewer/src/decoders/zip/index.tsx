/**
 * ZIP 解码器 —— src/decoders/zip/index.tsx
 *
 * fflate 读中央目录（filter 全 false——只收清单、零解压开销）→ 清单表
 * （名/原始/压缩后大小）→ 条目点击按需解压单个条目 → blob URL 经
 * resolveDecoder 内嵌预览（同注册表判定，image/text/csv 等皆可点开）。
 * 递归深度限制：zip→zip→zip 截停（depth ≥ 2 呈下载态，防压缩包套娃爆栈）。
 */
import { Suspense, useMemo, useState } from 'react';
import { unzipSync, type UnzipFileInfo } from 'fflate';
import { ArchiveIcon, DownloadIcon, FolderIcon, XIcon } from 'lucide-react';
import {
  DecoderShell,
  DecoderErrorState,
  InfoItem,
  downloadBytes,
  useObjectUrl,
} from '@/decoders/parts';
import { resolveDecoder, type DecoderFile } from '@/decoders/registry';
import { formatBytes } from '@/lib/format';
import { Button } from '@fde2e-tools/shared/ui/button';

/** 内嵌预览的最大递归深度（zip 里再套 zip 的截停线）。 */
const MAX_DEPTH = 2;

export default function ZipDecoder(file: DecoderFile) {
  const { name, mime, bytes, depth = 0 } = file;
  const [selected, setSelected] = useState<string | null>(null);

  /** 中央目录清单（filter 全 false：零解压，只收元数据）。 */
  const entries = useMemo<UnzipFileInfo[]>(() => {
    const list: UnzipFileInfo[] = [];
    unzipSync(bytes, {
      filter: (f) => {
        list.push(f);
        return false;
      },
    });
    return list;
  }, [bytes]);

  const files = useMemo(
    () => entries.filter((e) => !e.name.endsWith('/')).sort((a, b) => a.name.localeCompare(b.name)),
    [entries],
  );
  const dirCount = entries.length - files.length;

  /** 点开的条目：按需解压这一个条目（filter 精确命中）。 */
  const selectedEntry = useMemo(() => {
    if (!selected) return null;
    try {
      const out = unzipSync(bytes, { filter: (f) => f.name === selected });
      const data = out[selected];
      return data ? { name: selected, data } : null;
    } catch {
      return null;
    }
  }, [bytes, selected]);

  return (
    <DecoderShell
      main={
        entries.length === 0 ? (
          <DecoderErrorState
            title="压缩包为空或损坏"
            detail="中央目录中没有任何条目"
            onDownload={() => downloadBytes(bytes, name, mime)}
          />
        ) : (
          // 清单表直接落在面板内边距区（P1-1：解码器不再自带容器）
          <div className="h-full min-h-0 overflow-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="sticky top-0 border border-border bg-panel px-3 py-1.5 text-left font-semibold">
                    条目名
                  </th>
                  <th className="sticky top-0 border border-border bg-panel px-3 py-1.5 text-right font-semibold whitespace-nowrap">
                    原始大小
                  </th>
                  <th className="sticky top-0 border border-border bg-panel px-3 py-1.5 text-right font-semibold whitespace-nowrap">
                    压缩后
                  </th>
                </tr>
              </thead>
              <tbody>
                {dirCount > 0 ? (
                  <tr className="text-muted-foreground">
                    <td colSpan={3} className="border border-border px-3 py-1">
                      <FolderIcon className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
                      {dirCount} 个目录（不展开）
                    </td>
                  </tr>
                ) : null}
                {files.map((e) => (
                  <tr
                    key={e.name}
                    className={`cursor-pointer hover:bg-muted/40 ${selected === e.name ? 'bg-secondary text-foreground' : ''}`}
                    onClick={() => setSelected((cur) => (cur === e.name ? null : e.name))}
                  >
                    <td className="border border-border px-3 py-1 font-mono break-all">
                      <ArchiveIcon className="mr-1.5 inline size-3.5 align-[-2px] text-muted-foreground" aria-hidden />
                      {e.name}
                    </td>
                    <td className="border border-border px-3 py-1 text-right font-mono whitespace-nowrap">
                      {formatBytes(e.originalSize)}
                    </td>
                    <td className="border border-border px-3 py-1 text-right font-mono whitespace-nowrap text-muted-foreground">
                      {formatBytes(e.size)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      footer={
        <>
          <InfoItem label="条目" value={`${files.length} 个文件${dirCount > 0 ? ` ＋ ${dirCount} 个目录` : ''}`} />
          <InfoItem label="体积" value={formatBytes(bytes.byteLength)} />
          <span className="ml-auto whitespace-nowrap">点击条目名可内嵌预览</span>
        </>
      }
    >
      {/* 内嵌预览浮层：点开的条目经同一注册表判定渲染（业务接线层） */}
      {selectedEntry ? (
        <EntryPreviewOverlay
          entry={selectedEntry}
          depth={depth}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </DecoderShell>
  );
}

/** 单条目内嵌预览（浮在解码器主区上方，可关）。 */
function EntryPreviewOverlay({
  entry,
  depth,
  onClose,
}: {
  entry: { name: string; data: Uint8Array };
  depth: number;
  onClose: () => void;
}) {
  const url = useObjectUrl(entry.data, 'application/octet-stream');
  const decoder = resolveDecoder(entry.name, '', undefined);
  const EntryComponent = decoder.component;
  const tooDeep = depth + 1 >= MAX_DEPTH;

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background/80 backdrop-blur-sm">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <span className="truncate font-mono text-xs">{entry.name}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {formatBytes(entry.data.byteLength)}
        </span>
        <div className="ml-auto">
          <Button variant="ghost" size="icon-xs" aria-label="关闭预览" onClick={onClose}>
            <XIcon aria-hidden />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {url === null ? null : tooDeep ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground">嵌套过深（zip 套 zip），请下载后查看</p>
            <Button variant="outline" onClick={() => downloadBytes(entry.data, entry.name)}>
              <DownloadIcon data-icon="inline-start" aria-hidden />
              下载该条目
            </Button>
          </div>
        ) : (
          <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">加载解码器…</div>}>
            <EntryComponent
              url={url}
              name={entry.name}
              mime=""
              bytes={entry.data}
              depth={depth + 1}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
