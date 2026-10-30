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
