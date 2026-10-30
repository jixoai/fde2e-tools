/**
 * 视频解码器 —— src/decoders/video/index.tsx
 *
 * 原生 controls（浏览器自己管播放/进度/音量——不重造播放器）。大媒体走原始
 * URL 直连流式（不经整载 fetch/blob——数百 MB 视频整载会压垮标签页内存；直连
 * 天然吃服务端 Range，拖进度零全量）。zip 内嵌条目时 url 为条目 blob: 地址，
 * 直连同样成立。视频按容器等比放大占满（object-contain 语义），容器面 = 解码器
 * 统一玻璃面板（P1-5：删整屏灰底，不再自带背景色）。底部信息：时长/分辨率/体积/类型
 * ——体积在直连路径可能拿不到（HEAD 缺省），允许缺省不渲染该项。
 */
import { useEffect, useRef, useState } from 'react';
import { DecoderShell, InfoItem } from '@/decoders/parts';
import { normalizeMime, type DecoderFile } from '@/decoders/registry';
import { formatBytes, formatDuration } from '@/lib/format';

export default function VideoDecoder({ name, mime, bytes, url, size }: DecoderFile) {
  const [duration, setDuration] = useState<number | null>(null);
  const [resolution, setResolution] = useState<{ w: number; h: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // 元数据落地（vision P2-2）：直连 URL 后本地/缓存场景 metadata 事件在任何
  // 监听（含 React 合成 onLoadedMetadata，实测收不到）生效之前就已 fire——
  // 改 ref 原生监听＋挂载立即读值双保险：快路径 effect 同步读当前值，慢路径
  // 靠 loadedmetadata/durationchange/resize 事件补（read 幂等，多触发无害）。
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const read = () => {
      if (Number.isFinite(v.duration)) setDuration(v.duration);
      if (v.videoWidth > 0) setResolution({ w: v.videoWidth, h: v.videoHeight });
    };
    read();
    v.addEventListener('loadedmetadata', read);
    v.addEventListener('durationchange', read);
    v.addEventListener('resize', read);
    return () => {
      v.removeEventListener('loadedmetadata', read);
      v.removeEventListener('durationchange', read);
      v.removeEventListener('resize', read);
    };
  }, [url]);

  return (
    <DecoderShell
      main={
        // 容器面 = 面板本体（无自带底色）；等比放大占满可用区（P1-5）
        <div className="h-full min-h-0 w-full">
          <video
            ref={videoRef}
            src={url}
            controls
            autoPlay
            className="h-full w-full object-contain"
            aria-label={name}
          />
        </div>
      }
      footer={
        <>
          <InfoItem label="时长" value={duration === null ? '…' : formatDuration(duration)} />
          <InfoItem
            label="分辨率"
            value={resolution ? `${resolution.w} × ${resolution.h}` : '…'}
          />
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
