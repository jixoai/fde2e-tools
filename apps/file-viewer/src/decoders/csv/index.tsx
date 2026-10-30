/**
 * CSV/TSV 解码器 —— src/decoders/csv/index.tsx
 *
 * Papa Parse 解析（分隔符自动识别，CSV/TSV 同管）+ 分页表格（粘性表头）。
 * BOM 由 decodeUtf8 统一剥（omni 落盘 csv 带 BOM，读回往返一致）。
 * 底部信息：行×列 / 页码 / 上一页·下一页。
 */
import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { DecoderShell, InfoItem, decodeUtf8 } from '@/decoders/parts';
import type { DecoderFile } from '@/decoders/registry';
import { formatBytes } from '@/lib/format';
import { Button } from '@fde2e-tools/shared/ui/button';

const PAGE_SIZE = 50;

export default function CsvDecoder({ name, bytes }: DecoderFile) {
  const [page, setPage] = useState(0);

  const parsed = useMemo(() => {
    const text = decodeUtf8(bytes);
    const result = Papa.parse<string[]>(text, {
      skipEmptyLines: 'greedy',
    });
    return {
      rows: (result.data ?? []) as string[][],
      errors: result.errors ?? [],
    };
  }, [bytes]);

  const { rows } = parsed;
  const totalRows = rows.length;
  const columns = totalRows > 0 ? Math.max(...rows.map((r) => (r ? r.length : 0))) : 0;
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <DecoderShell
      main={
        totalRows === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            空文件（或无有效数据行）
          </div>
        ) : (
          // 表格直接落在面板内边距区（P1-1：解码器不再自带容器；粘性表头贴滚动区顶）
          <div className="h-full min-h-0 overflow-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="sticky top-0 z-10 w-10 border border-border bg-panel px-2 py-1.5 text-right font-mono text-muted-foreground">
                    #
                  </th>
                  {Array.from({ length: columns }, (_, c) => (
                    <th
                      key={c}
                      className="sticky top-0 z-10 border border-border bg-panel px-3 py-1.5 text-left font-semibold whitespace-nowrap"
                    >
                      {rows[0]?.[c] ?? ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* 首行已作表头，数据行从 1 起（单行文件则为空表体） */}
                {pageRows.slice(1).map((row, i) => (
                  <tr key={safePage * PAGE_SIZE + i} className="hover:bg-muted/40">
                    <td className="border border-border px-2 py-1 text-right font-mono text-muted-foreground">
                      {safePage * PAGE_SIZE + 1 + i}
                    </td>
                    {Array.from({ length: columns }, (_, c) => (
                      <td key={c} className="border border-border px-3 py-1 align-top">
                        {row?.[c] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      footer={
        <>
          <InfoItem label="规模" value={`${totalRows.toLocaleString('zh-CN')} 行 × ${columns} 列`} />
          <InfoItem label="大小" value={formatBytes(bytes.byteLength)} />
          {totalRows > PAGE_SIZE ? (
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="上一页"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeftIcon aria-hidden />
              </Button>
              <span className="font-mono whitespace-nowrap">
                第 {safePage + 1} / {pageCount} 页
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="下一页"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                <ChevronRightIcon aria-hidden />
              </Button>
            </div>
          ) : (
            <span className="ml-auto whitespace-nowrap">{name}</span>
          )}
        </>
      }
    />
  );
}
