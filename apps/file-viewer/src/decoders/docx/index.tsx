/**
 * Word (docx) 解码器 —— src/decoders/docx/index.tsx
 *
 * docx-preview（docxjs）渲染：分页观感、表格/图片/页眉页脚还原。
 * useBase64URL 开启——内嵌图片走 base64（避免库自建 blob URL 泄漏）。
 * 渲染失败 → DecoderErrorState 降级（下载出路），禁白屏。
 */
import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { FileTextIcon } from 'lucide-react';
import { DecoderShell, DecoderErrorState, DecoderLoading, InfoItem, downloadBytes } from '@/decoders/parts';
import type { DecoderFile } from '@/decoders/registry';
import { formatBytes } from '@/lib/format';

export default function DocxDecoder({ name, mime, bytes }: DecoderFile) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'rendering' | 'done' | 'failed' | 'empty'>('rendering');
  const [detail, setDetail] = useState<string>('');

  useEffect(() => {
    const body = bodyRef.current;
    const styleBox = styleRef.current;
    if (!body || !styleBox) return;
    let cancelled = false;
    setPhase('rendering');
    body.innerHTML = ''; // 重渲染前清容器（本内容为库产物，非未消毒外来 HTML）
    void (async () => {
      try {
        await renderAsync(bytes, body, styleBox, {
          inWrapper: true,
          breakPages: true,
          useBase64URL: true,
          ignoreLastRenderedPageBreak: false,
          experimental: true,
        });
        // 列表符号字形兜底（vision P1-6）：docx 的项目符号常取 Symbol/Wingdings
        // 私有区字形（U+F000–U+F8FF），无对应字体的环境渲染成豆腐块。库把这些
        // 字符字面写进注入的 <style>（:before content）——这里统一替换成通用
        // 圆点「•」，任何字体都可渲染。仅动样式文本，不碰文档正文。
        for (const style of Array.from(styleBox.querySelectorAll('style'))) {
          if (style.textContent) {
            style.textContent = style.textContent.replace(/[\uF000-\uF8FF]/g, '\u2022');
          }
        }
        if (cancelled) return;
        setPhase(body.childElementCount > 0 ? 'done' : 'empty');
      } catch (err) {
        if (!cancelled) {
          setDetail(err instanceof Error ? err.message : '未知解析错误');
          setPhase('failed');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  if (phase === 'failed') {
    return (
      <DecoderErrorState
        title="Word 文档解析失败"
        detail={detail || '该文件可能损坏或不是标准 OOXML 格式'}
        onDownload={() => downloadBytes(bytes, name, mime)}
      />
    );
  }
  if (phase === 'empty') {
    return (
      <DecoderErrorState
        title="文档内容为空"
        detail="文件可解析但没有可见内容"
        onDownload={() => downloadBytes(bytes, name, mime)}
      />
    );
  }

  return (
    <DecoderShell
      main={
        // 白纸直接落在玻璃面板上（P1-6）：库自带的 gray 桌面带由桥接层 CSS 收掉
        // （index.css .docx-host 规则），这里只留一个透明宿主＋滚动容器；
        // flex-col + my-auto 让短文档在面板内垂直居中、长文档照常滚动。
        <div className="flex h-full min-h-0 flex-col overflow-auto px-4 py-3">
          {phase === 'rendering' ? <DecoderLoading label="Word 文档渲染中…" /> : null}
          {/* docx-preview 的样式容器与其产物容器（业务接线，非手写组件） */}
          <div ref={styleRef} className="hidden" aria-hidden />
          <div className="docx-host mx-auto my-auto w-fit">
            <div ref={bodyRef} className="text-[14px]" />
          </div>
        </div>
      }
      footer={
        <>
          <InfoItem label="体积" value={formatBytes(bytes.byteLength)} />
          <InfoItem label="类型" value="Word (OOXML)" />
          {/* 对外品牌纪律：页脚只描述能力，不外露内部实现名（P1-7） */}
          <span className="ml-auto flex items-center gap-1 whitespace-nowrap">
            <FileTextIcon className="size-3.5" aria-hidden />
            渲染引擎 · 分页观感
          </span>
        </>
      }
    />
  );
}
