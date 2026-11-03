/**
 * 音频解码器 —— src/decoders/audio/index.tsx
 *
 * 原生 controls；大媒体走原始 URL 直连流式（同 video：不经整载 fetch/blob，
 * 服务端 Range 直接受益）。zip 内嵌条目时 url 为条目 blob: 地址，直连同样成立。
 * 体积在直连路径可能拿不到（HEAD 缺省），允许缺省不渲染该项。底部信息：时长/体积/类型。
 */
import { useEffect, useRef, useState } from 'react';
import { AudioLinesIcon } from 'lucide-react';
import { DecoderShell, InfoItem } from '@/decoders/parts';
import { normalizeMime, type DecoderFile } from '@/decoders/registry';
import { formatBytes, formatDuration } from '@/lib/format';

export default function AudioDecoder({ name, mime, bytes, url, size, frameless }: DecoderFile) {
  const [duration, setDuration] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 元数据落地（同 video P2-2 修复）：直连 URL 后 metadata 事件在任何监听生效
  // 之前就可能已 fire（本地/缓存秒载）——ref 原生监听＋挂载立即读值双保险。
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const read = () => {
      if (Number.isFinite(a.duration)) setDuration(a.duration);
    };
    read();
    a.addEventListener('loadedmetadata', read);
    a.addEventListener('durationchange', read);
    return () => {
      a.removeEventListener('loadedmetadata', read);
      a.removeEventListener('durationchange', read);
    };
  }, [url]);

  return (
    <DecoderShell
      main={
        <div className="flex h-full flex-col items-center justify-center gap-5">
          <AudioLinesIcon className="size-10 text-muted-foreground/60" data-viewer-chrome="audio-badge" aria-hidden />
          {/* 无壳模式不渲染原生 controls（截图面零控件；播放语义由带壳形态承担） */}
          <audio
            ref={audioRef}
            src={url}
            controls={!frameless}
            autoPlay
            className="w-full max-w-xl"
            aria-label={name}
          />
        </div>
      }
      footer={
        <>
          <InfoItem label="时长" value={duration === null ? '…' : formatDuration(duration)} />
          {size !== null && size !== undefined ? (
            <InfoItem label="体积" value={formatBytes(size)} />
          ) : bytes.byteLength > 0 ? (
            <InfoItem label="体积" value={formatBytes(bytes.byteLength)} />
          ) : null}
          <InfoItem label="类型" value={normalizeMime(mime) || '未知'} />
        </>
      }
    />
  );
}
