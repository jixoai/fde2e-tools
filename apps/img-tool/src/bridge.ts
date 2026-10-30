/*
 * img-tool 页面桥 —— apps/img-tool/src/bridge.ts
 *
 * WebMCP 工具（src/webmcp.ts）与 React 组件态（底图 ref）之间的窄通道：
 * App 挂载时把真实实现写进来；无底图时 redraw 为 no-op、hasImage 为 false。
 */
export const imgBridge: {
  redraw: () => void;
  hasImage: () => boolean;
} = {
  redraw: () => {},
  hasImage: () => false,
};
