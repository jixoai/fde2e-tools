/**
 * 预览尺寸门 —— src/lib/preview-gate.ts
 *
 * shiki 高亮的成本随内容字符数近似线性爆炸（token span 数量失控），大文件上会
 * 长时间阻塞主线程（Owner 实测「实在太卡」）。本模块是文本/Markdown 两个解码器
 * 共用的纯判定函数：按解码后文本长度（高亮/解析成本的真实驱动因子）给出预览
 * 路径，超限即降级零 token 化的快路径（纯 <pre>，浏览器渲染纯文本很快）。
 *
 * 全部为纯函数——不碰 DOM、不发异步，边界可独立单测。
 */

/** 文本解码器高亮上限：内容 ≤64KB 走 shiki，>64KB 纯 <pre>（字符数口径）。 */
export const TEXT_HIGHLIGHT_MAX_CHARS = 64 * 1024;

/** Markdown 代码块高亮上限：≤256KB 保留代码块 shiki 后处理；超过只跳过高亮步。 */
export const MD_HIGHLIGHT_MAX_CHARS = 256 * 1024;

/** Markdown 纯文本上限：>1MB 连 md 结构解析也跳过，直接纯文本 <pre> 呈现。 */
export const MD_PLAINTEXT_MAX_CHARS = 1024 * 1024;

/** 文本解码器预览路径。 */
export type TextPreviewPath =
  | 'highlight' // ≤64KB：shiki 高亮（既有路径）
  | 'plain'; // >64KB：纯 <pre> 快路径（零 token 化）

/**
 * 文本解码器路径判定：≤ 阈值（含边界）进高亮，超阈值一个字符即降级纯 pre。
 * 口径说明：以解码后字符数为准——shiki 的 token 化成本正比于字符数，而非字节
 * 数（多字节文本按字节算会高估可用高亮的预算）。
 */
export function textPreviewPath(textLength: number): TextPreviewPath {
  return textLength <= TEXT_HIGHLIGHT_MAX_CHARS ? 'highlight' : 'plain';
}

/** Markdown 解码器预览路径（三级门：全管线 → 跳代码块高亮 → 纯文本）。 */
export type MarkdownPreviewPath =
  | 'full' // ≤256KB：marked + 代码块 shiki + 消毒（既有全管线）
  | 'no-highlight' // >256KB：保留 marked + 消毒，跳过代码块 shiki（token 爆炸源）
  | 'plain'; // >1MB：直接纯文本 <pre>（md 结构解析本身也贵）

/** Markdown 路径判定：>1MB 纯文本；>256KB 跳高亮；其余全管线（边界就低不就高）。 */
export function markdownPreviewPath(textLength: number): MarkdownPreviewPath {
  if (textLength > MD_PLAINTEXT_MAX_CHARS) return 'plain';
  if (textLength > MD_HIGHLIGHT_MAX_CHARS) return 'no-highlight';
  return 'full';
}
