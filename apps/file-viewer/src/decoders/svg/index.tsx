/**
 * SVG 解码器 —— src/decoders/svg/index.tsx
 *
 * 形态：sandbox iframe 隔离渲染（禁脚本）——svg 里的动画/交互经浏览器原生
 * 支持（SMIL/CSS 动画在 sandbox 中仍可用），脚本被拒绝。
 */
import { SandboxFrameDecoder } from '@/decoders/sandbox-frame';
import type { DecoderFile } from '@/decoders/registry';

export default function SvgDecoder(file: DecoderFile) {
  return (
    <SandboxFrameDecoder
      file={file}
      blobMime="image/svg+xml;charset=utf-8"
      rendererLabel="SVG 预览"
      note="内嵌脚本不执行；图形/动画照常渲染"
    />
  );
}
