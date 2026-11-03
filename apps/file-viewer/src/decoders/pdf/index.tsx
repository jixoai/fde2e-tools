/**
 * PDF 解码器 —— src/decoders/pdf/index.tsx
 *
 * 字节 → application/pdf blob URL → iframe 交给浏览器原生 PDF 查看器
 * （Chrome/Firefox 的内置查看器自带分页/缩放/搜索，不重造）。
 * 安全注：iframe 不加 sandbox——浏览器 PDF 查看器运行在独立 PDF 渲染沙箱里，
 * 与页面 JS 隔离；sandbox 空串反而会使内置查看器拒绝渲染（空白 iframe 实证形态）。
 *
 * 无壳模式（?frameless=1）：iframe 去圆角铺满，并给 blob URL 追加查看器参数
 * `#toolbar=0&navpanes=0&scrollbar=0` 收掉原生工具条/侧栏/滚动条（Chrome/Edge
 * 原生查看器支持的 fragment 契约）。若某内核忽略这些参数，仍会保留原生工具条——
 * 属「浏览器原生查看器」边界（见 E2E 报告）；viewer 自身注入的 chrome 一律隐藏。
 */
import { DecoderShell, InfoItem, useObjectUrl, DecoderLoading } from '@/decoders/parts';
import { normalizeMime, type DecoderFile } from '@/decoders/registry';
import { formatBytes } from '@/lib/format';
import { useState } from 'react';

/** 无壳 PDF：原生查看器 fragment 参数（隐藏工具条/侧栏/滚动条，页面适配宽度）。 */
const FRAMELESS_PDF_FRAGMENT = '#toolbar=0&navpanes=0&scrollbar=0&view=FitH';
/**
 * iframe load 只代表查看器外壳就绪，PDFium 分页渲染仍在异步进行——留一小段
 * 首帧等待再上报就绪，避免无壳截图拿到「已 load、尚空白」的瞬间。
 */
const PDF_FIRST_PAINT_DELAY_MS = 800;

export default function PdfDecoder({ name, mime, bytes, frameless, onContentReady }: DecoderFile) {
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
              src={frameless ? `${objectUrl}${FRAMELESS_PDF_FRAGMENT}` : objectUrl}
              title={name}
              className={`h-full w-full border-0 ${frameless ? '' : 'rounded-lg'} ${loaded ? '' : 'opacity-0'}`}
              style={frameless ? { colorScheme: 'light' } : undefined}
              onLoad={() => {
                setLoaded(true);
                if (!frameless) return;
                // 等待 PDFium 首帧（原生查看器不可观测内部绘制，用有界延迟近似）
                window.setTimeout(() => onContentReady?.(), PDF_FIRST_PAINT_DELAY_MS);
              }}
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
