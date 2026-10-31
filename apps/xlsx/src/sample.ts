/*
 * 内置示例工作簿 —— apps/xlsx/src/sample.ts
 *
 * 示例含负数/小数/布尔/多表——正是绿门反读断言的采样面（SheetJS Node 侧
 * readFile 逐格核对）。JSON 文本运行时 stringify 生成，避免手写转义。
 */
import type { WorkbookSpec } from "./spec";

export const SAMPLE_WORKBOOK: WorkbookSpec = {
  sheets: [
    {
      name: "报销明细",
      rows: [
        ["项目", "金额", "备注"],
        ["差旅", 1280.5, "高铁往返"],
        ["住宿", 640, "两晚"],
        ["餐补", -80, "超支冲销"],
        ["是否通过", true, "主管已签"],
      ],
    },
    {
      name: "汇总",
      rows: [
        ["合计", 1840.5, ""],
        ["报销人", "张三", "示例数据"],
        ["月份", "2026-10", ""],
      ],
    },
  ],
};

export function sampleWorkbookJson(): string {
  return JSON.stringify(SAMPLE_WORKBOOK, null, 2);
}
