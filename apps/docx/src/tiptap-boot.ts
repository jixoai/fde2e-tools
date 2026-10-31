/*
 * TipTap 启动器 —— apps/docx/src/tiptap-boot.ts
 *
 * 本模块是唯一允许静态 import @tiptap/* 的位置：整块经 editor.ts dynamic
 * import，TipTap 全家桶落在独立 chunk，主包零携带（体积纪律）。
 * 扩展面：StarterKit（标题/段落/列表/粗斜/引用/代码块/撤销重做）＋Table 单包
 * 四件套（v3 合并形态）。
 */
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";

import type { FacadeEditor } from "./editor";

/** 在容器内创建 TipTap 编辑器并返回结构化最小面 */
export async function mountTiptap(container: HTMLElement, initialDoc: NonNullable<ConstructorParameters<typeof Editor>[0]>["content"]): Promise<FacadeEditor> {
  const ed = new Editor({
    element: container,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialDoc,
  });
  return ed as unknown as FacadeEditor;
}
