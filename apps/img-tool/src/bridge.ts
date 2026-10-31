/*
 * img-tool 页面桥 —— apps/img-tool/src/bridge.ts
 *
 * WebMCP 工具（src/webmcp.ts）与 React 组件态（底图 ref）之间的窄通道：
 * App 挂载时把真实实现写进来；无底图时 redraw 为 no-op、hasImage 为 false。
 */
export const imgBridge: {
  redraw: () => void;
  hasImage: () => boolean;
  /**
   * WebMCP export_png 的下载文件名一次性覆盖（F1 filename 参数）：置非 null
   * 后下一次下载按钮消费并复位；页面按钮路径（缺省 img-tool-<宽>x<高>.png）
   * 行为不变。
   */
  downloadName: string | null;
} = {
  redraw: () => {},
  hasImage: () => false,
  downloadName: null,
};
