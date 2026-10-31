/*
 * Univer 启动器 —— apps/xlsx/src/univer-boot.ts
 *
 * 本模块是唯一允许静态 import @univerjs/* 的位置：整块经 editor.ts dynamic
 * import，Univer（≈1.84MB gzip）+ locale 全部落在独立 chunk，主包零携带
 * （体积纪律）。preset-sheets-core 一键集成（Apache-2.0 OSS 子集，零 Pro 功能）。
 */
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";

import "@univerjs/preset-sheets-core/lib/index.css";

import type { FacadeUniver } from "./editor";

/** 在容器内创建 Univer 实例并返回 Facade API（编辑器生命周期由此开始） */
export async function mountUniver(container: HTMLElement): Promise<FacadeUniver> {
  const { univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS) },
    presets: [UniverSheetsCorePreset({ container })],
  });
  return univerAPI as unknown as FacadeUniver;
}
