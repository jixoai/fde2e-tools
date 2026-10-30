/**
 * PDF 解码器 —— src/decoders/pdf/index.tsx
 *
 * 字节 → application/pdf blob URL → iframe 交给浏览器原生 PDF 查看器
 * （Chrome/Firefox 的内置查看器自带分页/缩放/搜索，不重造）。
 * 安全注：iframe 不加 sandbox——浏览器 PDF 查看器运行在独立 PDF 渲染沙箱里，
 * 与页面 JS 隔离；sandbox 空串反而会使内置查看器拒绝渲染（空白 iframe 实证形态）。
 */
import { DecoderShell, InfoItem, useObjectUrl, DecoderLoading } from '@/decoders/parts';
import { normalizeMime, type DecoderFile } from '@/decoders/registry';
import { formatBytes } from '@/lib/format';
import { useState } from 'react';

export default function PdfDecoder({ name, mime, bytes }: DecoderFile) {
  const objectUrl = useObjectUrl(bytes, 'application/pdf');
  const [loaded, setLoaded] = useState(false);

  return (
    <DecoderShell
      main={
        // 面板内边距区即内容面（P1-1）；blob iframe 保持（浏览器原生查看器需要 blob）
        <div className="relative h-full min-h-0">
          {!loaded ? <DecoderLoading label="PDF 加载中…" /> : null}
          {objectUrl ? (
            <iframe
              key={objectUrl}
              src={objectUrl}
              title={name}
              className={`h-full w-full rounded-lg border-0 ${loaded ? '' : 'opacity-0'}`}
              onLoad={() => setLoaded(true)}
            />
          ) : null}
        </div>
      }
      footer={
        <>
          <InfoItem label="体积" value={formatBytes(bytes.byteLength)} />
          <InfoItem label="类型" value={normalizeMime(mime) || 'application/pdf'} />
          <span className="ml-auto whitespace-nowrap">浏览器原生查看器 · 分页/缩放/搜索用查看器控件</span>
        </>
      }
    />
  );
}
