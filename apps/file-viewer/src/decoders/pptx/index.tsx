/**
 * PPT (pptx) 解码器 —— src/decoders/pptx/index.tsx
 *
 * 选型：pptx-preview（npm 1.0.7，纯前端渲染，闭源但类型声明完整、jsDelivr
 * 演示可用）。尽力渲染——库加载/解析失败一律降级「下载查看」提示（规格
 * 「尽力渲染，失败降级下载」，选型结论随任务报告说明）。
 */
import { useEffect, useRef, useState } from 'react';
import { init } from 'pptx-preview';
import { PresentationIcon } from 'lucide-react';
import { DecoderShell, DecoderErrorState, DecoderLoading, InfoItem, downloadBytes, toArrayBuffer } from '@/decoders/parts';
import type { DecoderFile } from '@/decoders/registry';
import { formatBytes } from '@/lib/format';

export default function PptxDecoder({ name, mime, bytes }: DecoderFile) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'rendering' | 'done' | 'failed'>('rendering');
  const [detail, setDetail] = useState('');
  const [slideCount, setSlideCount] = useState<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let previewer: ReturnType<typeof init> | null = null;
    setPhase('rendering');
    container.innerHTML = ''; // 库产物容器重置（非未消毒外来 HTML）

    void (async () => {
      try {
        // init 需要确定宽高：按容器宽度出图（上限 960，16:9）
        const width = Math.min(container.clientWidth || 720, 960);
        const height = Math.round(width * 0.5625);
        previewer = init(container, { width, height, mode: 'list' });
        // 传给 preview 的是独立 ArrayBuffer 拷贝（byteOffset/长度归一）。
        // 必须等 Promise resolve——库在异步解析后才把幻灯片刷进 DOM，
        // 同步数 DOM 恒为 0（vision P1-7「幻灯片 0 页」的根因之一）。
        const resolved = (await previewer.preview(toArrayBuffer(bytes))) as
          | { slides?: unknown[] }
          | undefined;
        if (cancelled) return;
        // 真实页数：以渲染产物 DOM 实数为准（list 模式每页一个
        // .pptx-preview-slide-wrapper），空时退回解析回执（slides 数组）。
        const domCount = container.querySelectorAll('.pptx-preview-slide-wrapper').length;
        setSlideCount(domCount > 0 ? domCount : (resolved?.slides?.length ?? null));
        setPhase(container.childElementCount > 0 ? 'done' : 'failed');
        if (container.childElementCount === 0) setDetail('渲染器未产出幻灯片内容');
      } catch (err) {
        if (!cancelled) {
          setDetail(err instanceof Error ? err.message : 'pptx-preview 渲染失败');
          setPhase('failed');
        }
      }
    })();

    return () => {
      cancelled = true;
      // 库未提供 dispose；容器清空即释放其 DOM
      container.innerHTML = '';
    };
  }, [bytes]);

  if (phase === 'failed') {
    return (
      <DecoderErrorState
        title="幻灯片渲染失败"
        detail={`${detail}。站内预览为尽力渲染（能力边界内），可下载后用演示软件打开。`}
        onDownload={() => downloadBytes(bytes, name, mime)}
      />
    );
  }

  return (
    <DecoderShell
      main={
        // flex-col + my-auto：单页幻灯片在内容面垂直居中，多页超出时照常滚动（P1-7）
        <div className="flex h-full min-h-0 flex-col overflow-auto">
          {phase === 'rendering' ? <DecoderLoading label="幻灯片渲染中…" /> : null}
          <div ref={containerRef} className="pptx-host mx-auto my-auto w-fit" />
        </div>
      }
      footer={
        <>
          <InfoItem label="体积" value={formatBytes(bytes.byteLength)} />
          {slideCount !== null && slideCount > 0 ? (
            <InfoItem label="幻灯片" value={`${slideCount} 页`} />
          ) : null}
          {/* 对外品牌纪律：页脚只描述能力，不外露内部实现名（P1-7） */}
          <span className="ml-auto flex items-center gap-1 whitespace-nowrap">
            <PresentationIcon className="size-3.5" aria-hidden />
            渲染引擎 · 尽力渲染
          </span>
        </>
      }
    />
  );
}
