#!/usr/bin/env node
/**
 * POC ③：transformers.js v4 WebGPU vs WASM（whisper-base q8 实测转录）
 * （audio-stt-tts research §6.3；headless Chromium + playwright-core）
 *
 * 场景：本地静态服务 .models-cache/whisper-base-q8 → env.localModelPath 指缓存 →
 * 两个 provider（webgpu / wasm）各跑一次 3-5s 中文样例 → 对比延迟/输出。
 * WebGPU flag：--enable-unsafe-webgpu --enable-features=Vulkan（mac Metal 默认开）。
 *
 * 权重纪律：只读 .models-cache（gitignore），不下载（绿门权重预取走
 * prep:audio-smoke-weights，本 POC 同源）。
 * 用法：node scripts/poc-transformers-webgpu.cjs
 */
const { createServer } = require("node:http");
const { readFileSync, existsSync } = require("node:fs");
const { join, dirname, resolve } = require("node:path");
const { fileURLToPath } = require("node:url");

const ROOT = resolve(__dirname, "..");
const CACHE = process.env.FDE2E_MODELS_CACHE_DIR || join(ROOT, ".models-cache");
const MODEL_DIR = join(CACHE, "whisper-base-q8");
const CHROME_CANDIDATES = [
  process.env.WEBMCP_CHECK_CHROME,
  join(process.env.HOME ?? "", "Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
  join(process.env.HOME ?? "", "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
].filter(Boolean);

async function main() {
  if (!existsSync(MODEL_DIR)) {
    console.error(`✗ 权重不在场：${MODEL_DIR}（跑 bash deploy/models-fetch.sh fetch whisper-base-q8）`);
    process.exit(1);
  }
  const { chromium } = require("playwright-core");
  const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!executablePath) { console.error("✗ 找不到本机 Chromium"); process.exit(1); }

  // transformers.js 从 CDN 拉太慢且断网不可测——用 node_modules 的 dist 直接服务
  const TJS_DIST = process.env.TJS_DIST || "/tmp/transformers-poc/node_modules/@huggingface/transformers/dist";
  if (!existsSync(TJS_DIST)) {
    console.error(`✗ transformers dist 不在场：${TJS_DIST}（POC 前置：cd /tmp && pnpm add @huggingface/transformers@4.3.2，或设 TJS_DIST）`);
    process.exit(1);
  }
  const ORT_DIST = process.env.ORT_DIST || "/tmp/transformers-poc/node_modules/.pnpm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/node_modules/onnxruntime-web/dist";
  if (!existsSync(ORT_DIST)) {
    console.error(`✗ ort-web dist 不在场：${ORT_DIST}（同上）`);
    process.exit(1);
  }

  // 样例音频：sense-voice test_wavs/zh.wav（16kHz 单声道 wav，3-5s 中文）
  const samplePath = join(CACHE, "sense-voice-int8-2024-07-17", "test_wavs", "zh.wav");
  const sample = readFileSync(samplePath);

  const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".txt": "text/plain" };
  const roots = [
    // HF 形态兼容（remotePathTemplate 产出 /<model>/resolve/<rev>/<file>；自托管 mirror 同构）
    ["/model/onnx-community/whisper-base/resolve/main/", MODEL_DIR],
    ["/model/", MODEL_DIR],
    ["/tjs/", TJS_DIST],
    ["/ort/", ORT_DIST],
    ["/sample.wav", null], // 特判
  ];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x").pathname;
    if (process.env.POC_VERBOSE) console.log("[req]", url);
    if (url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><meta charset='utf-8'>poc");
      return;
    }
    if (url === "/sample.wav") {
      res.writeHead(200, { "content-type": "audio/wav" });
      res.end(sample);
      return;
    }
    for (const [prefix, dir] of roots) {
      if (dir && url.startsWith(prefix)) {
        const p = join(dir, url.slice(prefix.length));
        try {
          const body = readFileSync(p);
          const ext = p.slice(p.lastIndexOf("."));
          res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
          res.end(body);
          return;
        } catch { console.log("[404]", url); }
      }
    }
    res.writeHead(404); res.end("nf");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--no-sandbox"],
  });
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("[page]", m.type(), m.text().slice(0, 240)); });
  await page.goto(`${base}/`, { waitUntil: "load" });
  // 简化：直接 evaluate import
  const out = await page.evaluate(async ({ base, sampleUrl, allowRemote }) => {
    const log = [];
    try {
      const tjs = await import(base + "/tjs/transformers.min.js");
      const { pipeline, env } = tjs;
      // 自托管同源语义：全部请求打本地 server——transformers.js 的 localModelPath
      // 只认非 http 路径（http URL + local_files_only 会 throw，见 y\$/qr 源码），
      // 因此自托管部署＝把 remoteHost 指到同源 base。
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.remoteHost = base + "/model/";
      env.remotePathTemplate = "{model}/resolve/{revision}/";
      env.useBrowserCache = false; // 排除 Cache API 干扰（POC 语义；正式形态走 cache.ts）
      env.backends.onnx.wasm.wasmPaths = base + "/ort/";

      const results = {};
      // WebGPU 探测
      let hasGpu = false;
      try { const a = await navigator.gpu.requestAdapter(); hasGpu = !!a; } catch {}
      results.hasWebGPU = hasGpu;

      const runOne = async (device) => {
        const t0 = performance.now();
        const asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-base", {
          device,
          dtype: "q8",
          progress_callback: null,
          local_files_only: false, // 自托管源全走 remote 通道（即同源 http）
        });
        const loadMs = performance.now() - t0;
        const t1 = performance.now();
        const out = await asr(sampleUrl, { language: "chinese", task: "transcribe" });
        const inferMs = performance.now() - t1;
        return { loadMs: Math.round(loadMs), inferMs: Math.round(inferMs), text: out.text };
      };

      if (hasGpu) {
        try { results.webgpu = await runOne("webgpu"); }
        catch (e) { results.webgpu = { error: String(e.message ?? e).slice(0, 300) }; }
      }
      try { results.wasm = await runOne("wasm"); }
      catch (e) { results.wasm = { error: String(e.message ?? e).slice(0, 300) }; }
      return results;
    } catch (e) {
      return { fatal: String(e.message ?? e).slice(0, 400) };
    }
  }, { base, sampleUrl: base + "/sample.wav", allowRemote: process.env.POC_ALLOW_REMOTE === "1" });

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  server.close();

  // 判定
  if (out.fatal) { console.error("✗ POC fatal"); process.exit(1); }
  const ok = (r) => r && !r.error && r.text && r.text.trim().length > 0;
  if (!ok(out.wasm)) { console.error("✗ WASM 路线失败（兜底必须活）"); process.exit(1); }
  console.log(out.webgpu && !out.webgpu.error
    ? `★ POC ③：WebGPU ${out.webgpu.inferMs}ms vs WASM ${out.wasm.inferMs}ms（load ${out.webgpu.loadMs}/${out.wasm.loadMs}ms）`
    : "★ POC ③：WebGPU 不可用（headless 探测失败属预期之一），WASM 兜底 " + out.wasm.inferMs + "ms 正常");
}
main().catch((e) => { console.error(e); process.exit(1); });
