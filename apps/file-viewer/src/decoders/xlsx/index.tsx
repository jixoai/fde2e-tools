/**
 * Excel (xlsx) 解码器 —— src/decoders/xlsx/index.tsx
 *
 * SheetJS CE（官方 CDN 发行版，npm 上的 xlsx 包已停更）解析 + sheet 页签
 * + 前 200 行表格（总行数照登，规格「前 N 行＋总行数」）。xls/xlsm 同管。
 * 底部信息：sheet 数/行×列/显示范围/体积。
 */
import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { FileSpreadsheetIcon } from 'lucide-react';
import { DecoderShell, DecoderErrorState, InfoItem, downloadBytes } from '@/decoders/parts';
import type { DecoderFile } from '@/decoders/registry';
import { formatBytes } from '@/lib/format';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@fde2e-tools/shared/ui/tabs';

const MAX_ROWS = 200;

export default function XlsxDecoder({ name, mime, bytes }: DecoderFile) {
  const parsed = useMemo<{ ok: true; sheets: SheetData[] } | { ok: false; error: string }>(() => {
    try {
      const wb = XLSX.read(bytes, { type: 'array' });
      const sheets = wb.SheetNames.map((sheetName) => {
        const ws = wb.Sheets[sheetName];
        // header:1 → 二维数组；raw:false → 取格式化文本（所见即所得）；defval 补空格
        const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' });
        return { sheetName, rows };
      });
      return { ok: true, sheets };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '表格解析失败' };
    }
  }, [bytes]);

  const [activeSheet, setActiveSheet] = useState(0);
  const sheet = parsed.ok ? parsed.sheets[Math.min(activeSheet, parsed.sheets.length - 1)] : null;
  const shownRows = sheet ? sheet.rows.slice(0, MAX_ROWS) : [];
  const columns = shownRows.reduce((max, r) => Math.max(max, Array.isArray(r) ? r.length : 0), 0);

  if (!parsed.ok) {
    return (
      <DecoderErrorState
        title="表格解析失败"
        detail={parsed.error}
        onDownload={() => downloadBytes(bytes, name, mime)}
      />
    );
  }

  return (
    <DecoderShell
      main={
        <Tabs
          value={String(Math.min(activeSheet, parsed.sheets.length - 1))}
          onValueChange={(v) => setActiveSheet(Number(v))}
          className="flex h-full min-h-0 flex-col"
        >
          <TabsList className="mx-4 mt-4 w-fit max-w-[calc(100%-2rem)] overflow-x-auto">
            {parsed.sheets.map((s, i) => (
              <TabsTrigger key={s.sheetName} value={String(i)} className="max-w-40 truncate">
                {s.sheetName}
              </TabsTrigger>
            ))}
          </TabsList>
          {sheet ? (
            <TabsContent value={String(activeSheet)} className="min-h-0 flex-1 overflow-auto px-4 pt-3 pb-4">
              {sheet.rows.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  该 sheet 为空
                </div>
              ) : (
                <table className="w-full border-collapse text-[13px]">
                  <tbody>
                    {shownRows.map((row, r) => (
                      <tr key={r} className="hover:bg-muted/40">
                        <td className="border border-border bg-panel px-2 py-1 text-right font-mono text-muted-foreground">
                          {r + 1}
                        </td>
                        {Array.from({ length: columns }, (_, c) => (
                          <td key={c} className="border border-border px-3 py-1 align-top">
                            {Array.isArray(row) ? (row[c] ?? '') : ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </TabsContent>
          ) : null}
        </Tabs>
      }
      footer={
        <>
          <InfoItem label="sheet 数" value={parsed.sheets.length} />
          <InfoItem
            label="规模"
            value={
              sheet
                ? `${sheet.rows.length.toLocaleString('zh-CN')} 行 × ${columns} 列`
                : '—'
            }
          />
          {sheet && sheet.rows.length > MAX_ROWS ? (
            <InfoItem label="显示" value={`前 ${MAX_ROWS} 行（其余请下载查看）`} />
          ) : null}
          <InfoItem label="大小" value={formatBytes(bytes.byteLength)} />
          {/* 对外品牌纪律：页脚只描述能力，不外露内部实现名（P1-7 同族收口） */}
          <span className="ml-auto flex items-center gap-1 whitespace-nowrap">
            <FileSpreadsheetIcon className="size-3.5" aria-hidden />
            渲染引擎 · 本地解析
          </span>
        </>
      }
    />
  );
}

interface SheetData {
  sheetName: string;
  rows: string[][];
}
