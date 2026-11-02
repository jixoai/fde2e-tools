#!/usr/bin/env node
/**
 * downloader-core web bundle 构建 —— scripts/build-downloader-core.mjs
 * （audio-stt-tts tasks 1.3；纪律复刻自主仓 site/scripts/build-downloader-core.mjs）
 *
 * 源：fde2e 主仓 packages/downloader-core/src/web.ts（跨仓单源，跨机路径经
 * FDE2E_DOWNLOADER_SRC 或默认布局解析）。
 * 产物：packages/audio-engine/vendor/smart-dl-core.js（IIFE，挂
 * globalThis.FDE2ESmartDLCore；各音频 app 构建时随 dist 分发）。
 *
 * 用法：
 *   node scripts/build-downloader-core.mjs           # 构建到临时目录（不动 vendor）
 *   node scripts/build-downloader-core.mjs --write   # 落位 vendor/
 *   node scripts/build-downloader-core.mjs --check   # 漂移门：重建与 vendor 逐字节比对
 *
 * 确定性：rolldown 无时间戳/minify 变量哈希，同输入同选项→逐字节一致（--check 前提）。
 */
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_FILE = join(ROOT, "packages/audio-engine/vendor/smart-dl-core.js");

const DL_SRC =
  process.env.FDE2E_DOWNLOADER_SRC ||
  join(ROOT, "..", "..", "packages", "downloader-core", "src", "web.ts");
if (!existsSync(DL_SRC)) {
  console.error(`✗ downloader-core web.ts 不存在: ${DL_SRC}（设 FDE2E_DOWNLOADER_SRC 指向主仓）`);
  process.exit(1);
}

const BANNER = `/**
 * FDE2E smart-dl-core —— 多源 Range 并行下载核心（fde2e-downloader-core bundle）
 *
 * 由 scripts/build-downloader-core.mjs 从主仓 packages/downloader-core 构建生成，
 * 禁止手改；漂移由 --check 门把守（重建 diff 必须为零）。
 * 对外 API 冻结：globalThis.FDE2ESmartDLCore（audio-stt/tts 两站模型下载消费）。
 */
`;

async function buildTo(outfile) {
  const rolldownPath = new URL("../node_modules/.pnpm/node_modules/rolldown/dist/index.mjs", import.meta.url);
  const { rolldown } = await import(rolldownPath.href);
  const bundle = await rolldown({ input: DL_SRC, platform: "browser" });
  const { output } = await bundle.generate({ format: "iife", name: "FDE2ESmartDLCoreBundle" });
  const code = BANNER + output[0].code;
  writeFileSync(outfile, code);
  return code.length;
}

const args = process.argv.slice(2);
if (args.includes("--check")) {
  if (!existsSync(VENDOR_FILE)) {
    console.error(`✗ vendor 缺失：${VENDOR_FILE}（先 --write）`);
    process.exit(1);
  }
  const tmp = join(mkdtempSync(join(tmpdir(), "dlcore-check-")), "smart-dl-core.js");
  await buildTo(tmp);
  const a = readFileSync(VENDOR_FILE), b = readFileSync(tmp);
  if (!a.equals(b)) {
    console.error("✗ 漂移：vendor/smart-dl-core.js 与主仓单源重建不一致（跑 --write 重新落位并提交）");
    process.exit(1);
  }
  console.log("✓ 漂移门过：vendor 与主仓单源逐字节一致");
  process.exit(0);
}

if (args.includes("--write")) {
  const bytes = await buildTo(VENDOR_FILE);
  console.log(`✓ 落位 ${VENDOR_FILE}（${(bytes / 1024).toFixed(1)} KiB）`);
  process.exit(0);
}

const tmp = join(mkdtempSync(join(tmpdir(), "dlcore-build-")), "smart-dl-core.js");
const bytes = await buildTo(tmp);
console.log(`✓ 构建到临时目录（${(bytes / 1024).toFixed(1)} KiB）：${tmp}`);
console.log("  落位加 --write；漂移门加 --check");
