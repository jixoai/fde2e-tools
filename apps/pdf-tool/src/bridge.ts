/*
 * pdf-tool 页面桥 —— apps/pdf-tool/src/bridge.ts
 *
 * WebMCP 工具（src/webmcp.ts）与 React 导出流程之间的窄通道：
 * export_pdf 的 filename 参数（F1）经此一次性覆盖下载文件名；App 消费后复位，
 * 页面按钮路径（缺省 pdf-tool-export.pdf）行为不变。
 */
export const exportBridge: {
  /** 一次性下载文件名覆盖（非 null 时下一次导出消费并复位） */
  filename: string | null;
} = {
  filename: null,
};
