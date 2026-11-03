#!/usr/bin/env node
/**
 * audio 绿门聚合入口（tasks 5.1；权重缺失＝fail 非 skip）
 * 用法：pnpm audio-smoke
 * 前置：pnpm prep:audio-smoke-weights（models-fetch 按 manifest 钉版本预取）
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url)) + "/..";
// 必需模型 root 按 manifest 投影（models-fetch --emit-manifest 与 manifest.ts 同源）
const REQUIRED_MODELS = ["whisper-base-q8", "kokoro-v1_1-zh-int8"];
const manifest = JSON.parse(readFileSync(join(ROOT, "deploy/models.manifest.json"), "utf8"));
const REQUIRED = REQUIRED_MODELS.map(
  (id) => manifest.find((m) => m.modelId === id)?.root ?? id,
);
const missing = REQUIRED.filter((root) => !existsSync(join(ROOT, ".models-cache", root)));
if (missing.length) {
  console.error(`✗ 权重不在场（缺 ${missing.join(", ")}）——先跑 pnpm prep:audio-smoke-weights（Owner 裁决：缺失=fail 非 skip）`);
  process.exit(1);
}
console.log("✓ 权重预取检查过（whisper-base-q8 ＋ kokoro-v1_1-zh-int8 在场）");

for (const [name, script] of [
  ["stt", "scripts/audio-stt-smoke.mjs"],
  ["tts", "scripts/audio-tts-smoke.mjs"],
]) {
  console.log(`\n=== audio-smoke [${name}] ===`);
  const r = spawnSync("node", [script], { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) {
    console.error(`✗ audio-smoke [${name}] 失败`);
    process.exit(1);
  }
}
console.log("\n★ audio-smoke 全过（stt＋tts 真推理往返）");
