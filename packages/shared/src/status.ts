/*
 * 状态行 —— packages/shared/src/status.ts
 *
 * 三个存量工具的 id=status 状态行惯例收口：kind→色类映射走官方主题语义
 * token（text-success / text-destructive / text-status-interrupted）。
 * 契约：id=status 的文本内容是各工具行为的一部分（智能体会读），色类只是皮肤。
 */
export type StatusKind = "ok" | "error" | "warn";

export function statusTextClass(kind: StatusKind): string {
  switch (kind) {
    case "error":
      return "text-destructive";
    case "warn":
      return "text-status-interrupted";
    default:
      return "text-success";
  }
}

/**
 * 生成反馈可见性（office-suite 视觉验收修复，2026-10-31）：预览内容较长时
 * 「生成按钮＋#status」会落在折叠线下，点击生成后状态反馈不可见（vision 实测
 * docx 长文档场景）。统一模式＝状态更新后把 #status 滚入视口——block:"nearest"
 * 最小滚动（已在视口内则零滚动，不抖动），按钮在状态行正上方一并可见。
 * 生成三站（xlsx/docx/pptx）共用；pdf-tool 暂不动（家族级备忘另行决策）。
 */
export function scrollStatusIntoView(): void {
  if (typeof document === "undefined") return;
  document.getElementById("status")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
