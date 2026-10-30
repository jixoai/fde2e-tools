/*
 * AI 使用说明块 —— packages/shared/src/ai-guide.tsx
 *
 * 业务接线层（非 shadcn 组件）：三个存量工具的页首 <pre id="ai-guide"> 惯例
 * （给自动化代理读的纯文本说明）在此收口成共享件——id 惯例与等宽排版统一。
 * 内容走 children（字符串或含示例链接的 JSX 片段）；样式走官方主题 token
 * （glass-control 材质 + 字体工具类）。注意：whitespace-pre-wrap 下 JSX 文本
 * 节点的换行缩进会被折叠，多段文案请以 {string} 表达式传入。
 */
import type { ReactNode } from "react";

export function AiGuide({ children }: { children: ReactNode }) {
  return (
    <pre
      id="ai-guide"
      className="glass-control rounded-xl px-4 py-4 font-mono text-[13px]/7 whitespace-pre-wrap overflow-x-auto mb-5 [&_a]:text-link [&_a]:font-semibold"
    >
      {children}
    </pre>
  );
}
