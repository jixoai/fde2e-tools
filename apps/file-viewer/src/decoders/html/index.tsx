/**
 * HTML 解码器 —— src/decoders/html/index.tsx
 *
 * 形态：sandbox iframe 隔离渲染（禁脚本）——与 svg 同一安全词汇表（见
 * sandbox-frame.tsx），零 innerHTML 直注。
 */
import { SandboxFrameDecoder } from '@/decoders/sandbox-frame';
import type { DecoderFile } from '@/decoders/registry';

export default function HtmlDecoder(file: DecoderFile) {
  return (
    <SandboxFrameDecoder
      file={file}
      blobMime="text/html;charset=utf-8"
      rendererLabel="HTML 预览"
      note="内嵌脚本/表单/弹窗全部被沙箱拒绝；需要原貌请用顶栏「新窗口打开原始内容（?raw）」下载后打开"
    />
  );
}
