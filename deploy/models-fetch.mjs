#!/usr/bin/env node
/**
 * 模型权重拉取 —— deploy/models-fetch.mjs（tasks 1.2；models-fetch.sh 的实现内核）
 *
 * manifest 单源＝packages/audio-engine/src/manifest.ts（浏览器与脚本同源）。
 * 由于 manifest 是 TS，本脚本维护一份由构建脚本生成的 JSON 投影：
 *   node deploy/models-fetch.mjs --emit-manifest > deploy/models.manifest.json
 * 投影由 --check 守漂移（改 manifest 忘了重新生成＝fail）。
 *
 * 拉取语义（spec「模型 manifest 单源与 sha 门」）：
 *  - 全部经 downloader-core Node 轨道（createNodeDownload）：多源分片＋断点续传
 *    ＋sha256 三态门（expectedSha256 全挂，禁 no-expected 出现在线上路径）；
 *  - 落位 .models-cache/<root>/<path>（gitignore；dist 部署由编排者侧收）；
 *  - 逐文件校验 fail-closed：mismatch 即删除半成品并退出非零。
 *
 * 用法：
 *   node deploy/models-fetch.mjs --list                 # 列清单（模型/文件/源）
 *   node deploy/models-fetch.mjs --emit-manifest        # 输出 JSON 投影（stdout）
 *   node deploy/models-fetch.mjs --check                # 投影漂移门（CI/绿门用）
 *   node deploy/models-fetch.mjs --verify               # 本地缓存 sha256 全量对表
 *   node deploy/models-fetch.mjs --model <modelId>      # 只拉一个模型（缺省全量）
 *   node deploy/models-fetch.mjs                        # 全量拉取（幂等，命中跳过）
 * 环境变量：
 *   MODELS_FETCH_BASE  自托管同源 base（缺省 https://stt.tool.fde2e.com）
 *   MODELS_FETCH_SKIP_MS  探测用：跳过实际下载只校验已在场文件
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = process.env.FDE2E_MODELS_CACHE_DIR
  ? resolve(process.env.FDE2E_MODELS_CACHE_DIR)
  : join(ROOT, ".models-cache");
const PROJECTION = join(ROOT, "deploy", "models.manifest.json");

/** rolldown 定位（pnpm 虚拟.store 内；跨机路径由 import.meta.url 锚定，稳） */
const rolldownPath0 = new URL("../node_modules/.pnpm/node_modules/rolldown/dist/index.mjs", import.meta.url);

/** 读 manifest 单源：rolldown（vite 8 自带，仓库现有依赖）现场打包 manifest.ts */
async function loadManifest() {
  const { rolldown } = await import(rolldownPath0.href);
  const bundle = await rolldown({
    input: join(ROOT, "packages/audio-engine/src/manifest.ts"),
    platform: "node",
  });
  const { output } = await bundle.generate({ format: "esm" });
  return await import(
    "data:text/javascript;base64," + Buffer.from(output[0].code).toString("base64")
  );
}

const args = process.argv.slice(2);
const manifest = await loadManifest();
const MODELS = manifest.AUDIO_MODELS;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 组 URL：自托管＝base+root+path；modelscope/hf 按模板替换 */
function urlFor(m, s, f) {
  if (s.id === "selfhost") {
    const base = (process.env.MODELS_FETCH_BASE || "https://stt.tool.fde2e.com").replace(/\/$/, "");
    return `${base}${s.urlTemplate.replace("{path}", f.path)}`;
  }
  if (s.id === "modelscope") {
    return s.urlTemplate
      .replace("{pathEnc}", encodeURIComponent(f.path))
      .replace("{path}", f.path);
  }
  if (s.id === "hf") {
    return s.urlTemplate.replace("{path}", f.path);
  }
  throw new Error(`未知源 id: ${s.id}`);
}

/** downloader-core 源池（Node 轨道）：自托管→modelscope→hf 顺位 */
async function nodeSources(m) {
  const { Source } = await import("./dl-core-node.mjs");
  return m.sources
    .filter((s) => !(s.id === "modelscope" && s.urlTemplate.includes("//")))
    .map((s) => new Source(s.id, (u) => u)); // urlFor 已产出完整 URL，直通
}

function localPathOf(m, f) {
  return join(CACHE_DIR, m.root, f.path);
}

function verifyOne(m, f) {
  const p = localPathOf(m, f);
  if (!existsSync(p)) return { ok: false, reason: "missing", path: p };
  const size = statSync(p).size;
  if (size !== f.bytes) return { ok: false, reason: `size ${size}≠${f.bytes}`, path: p };
  const bytes = readFileSync(p);
  const actual = sha256(bytes);
  if (actual !== f.sha256) return { ok: false, reason: `sha256 ${actual.slice(0, 12)}…≠${f.sha256.slice(0, 12)}…`, path: p };
  return { ok: true, path: p };
}

/* ---------- --list ---------- */
if (args.includes("--list")) {
  for (const m of MODELS) {
    const total = m.files.reduce((a, f) => a + f.bytes, 0);
    console.log(`${m.modelId}  [${m.use}/${m.engine}]  ${m.name}`);
    console.log(`  root=${m.root}  files=${m.files.length}  total=${(total / 1048576).toFixed(1)}MB  tier=${m.minDeviceTier}  license=${m.licenseTag}`);
    for (const s of m.sources) console.log(`  source ${s.id} (${s.role}${s.range ? ",range" : ""})`);
    for (const f of m.files) console.log(`    ${f.path}  ${f.bytes}B  ${f.sha256.slice(0, 12)}…`);
  }
  process.exit(0);
}

/* ---------- --emit-manifest / --check ---------- */
if (args.includes("--emit-manifest") || args.includes("--check")) {
  const json = JSON.stringify(
    MODELS.map((m) => ({
      modelId: m.modelId,
      use: m.use,
      engine: m.engine,
      root: m.root,
      licenseTag: m.licenseTag,
      notice: m.notice,
      minDeviceTier: m.minDeviceTier,
      totalBytes: m.files.reduce((a, f) => a + f.bytes, 0),
      files: m.files,
      sources: m.sources,
    })),
    null,
    2,
  ) + "\n";
  if (args.includes("--emit-manifest")) {
    process.stdout.write(json);
    process.exit(0);
  }
  if (!existsSync(PROJECTION)) {
    console.error(`✗ 投影缺失：${PROJECTION}（跑 node deploy/models-fetch.mjs --emit-manifest > deploy/models.manifest.json）`);
    process.exit(1);
  }
  const live = readFileSync(PROJECTION, "utf8");
  if (live !== json) {
    console.error("✗ 投影漂移：manifest.ts 与 deploy/models.manifest.json 不一致（重新生成并提交）");
    process.exit(1);
  }
  console.log("✓ 投影一致（models.manifest.json 与 manifest.ts 逐字节对上）");
  process.exit(0);
}

/* ---------- --verify ---------- */
if (args.includes("--verify")) {
  let fail = 0;
  for (const m of MODELS) {
    for (const f of m.files) {
      const r = verifyOne(m, f);
      if (!r.ok) {
        console.error(`✗ ${m.modelId}/${f.path}: ${r.reason}`);
        fail++;
      }
    }
    console.log(`· ${m.modelId}: ${fail ? "有缺" : "✓ 全部在场且 sha 对"}`);
  }
  process.exit(fail ? 1 : 0);
}

/* ---------- 拉取（缺省全量；--model 单模型） ---------- */
const onlyModel = args.includes("--model") ? args[args.indexOf("--model") + 1] : null;
const skipDownload = !!process.env.MODELS_FETCH_SKIP_MS;
const targets = onlyModel ? MODELS.filter((m) => m.modelId === onlyModel) : MODELS;
if (onlyModel && !targets.length) {
  console.error(`✗ 未知模型: ${onlyModel}（可选: ${MODELS.map((m) => m.modelId).join(", ")}）`);
  process.exit(1);
}

// downloader-core Node 轨道（rolldown 现场打包主仓单源 index.ts）
// 源路径优先级：环境变量（跨机路径不同）→ 主仓本地检出（开发机默认布局）
const DL_SRC =
  process.env.FDE2E_DOWNLOADER_SRC ||
  join(ROOT, "..", "..", "packages", "downloader-core", "src", "index.ts");
if (!existsSync(DL_SRC)) {
  console.error(`✗ downloader-core 单源不存在: ${DL_SRC}（设 FDE2E_DOWNLOADER_SRC 指向主仓 packages/downloader-core/src/index.ts）`);
  process.exit(1);
}
const { rolldown: rd2 } = await import(rolldownPath0.href);
const coreBundle = await rd2({ input: DL_SRC, platform: "node" });
const coreOut = await coreBundle.generate({ format: "esm" });
const coreCode = (coreOut.output ?? coreOut.outputFiles)?.[0]?.code;
if (!coreCode) {
  console.error("✗ downloader-core 打包无产物（rolldown generate 形态变化？）");
  process.exit(1);
}
const core = await import("data:text/javascript;base64," + Buffer.from(coreCode).toString("base64"));

let failures = 0;
for (const m of targets) {
  console.log(`\n=== ${m.modelId}（${m.files.length} 文件）===`);
  for (const f of m.files) {
    const check = verifyOne(m, f);
    if (check.ok) {
      console.log(`  ✓ ${f.path}（已缓存）`);
      continue;
    }
    if (skipDownload) {
      console.error(`  ✗ ${f.path}: ${check.reason}（SKIP_MS 不下载）`);
      failures++;
      continue;
    }
    const p = localPathOf(m, f);
    mkdirSync(dirname(p), { recursive: true });
    // 源池顺位尝试：单源成功即走（downloader 内部自做并发/续传；这里做跨源 fallback）
    const pool = manifest.sourcePoolOf(m);
    if (!pool.length) {
      console.error(`  ✗ ${f.path}: 该模型无运行时源（sherpa 系＝自托管唯一源；开发期先跑 prep:audio-smoke-weights 或拷贝 .models-cache seed）`);
      failures++;
      continue;
    }
    let done = false;
    let lastErr = null;
    for (const s of pool) {
      const url = urlFor(m, s, f);
      // 源可用性探针（Range 0-0）：404/5xx 直接跳过该源；206/200 都算可用
      // （200＝全量源——ModelScope resolve 实测，见 research §6.2——大件也走直取）
      let rangeOk = false;
      try {
        const probe = await fetch(url, { headers: { range: "bytes=0-0" }, signal: AbortSignal.timeout(15000) });
        if (!probe.ok && probe.status !== 206) {
          lastErr = new Error(`HTTP ${probe.status}（探针）`);
          console.warn(`  · 源 ${s.id} 不可用: ${lastErr.message}`);
          continue;
        }
        rangeOk = probe.status === 206;
      } catch (e) {
        lastErr = e;
        console.warn(`  · 源 ${s.id} 探针失败: ${e.message}`);
        continue;
      }
      // 直取路径：小文件，或源不支持 Range（206 判定失败＝200-全量源）。
      // downloader 的多源分片只在 206-Range 源上工作（ModelScope resolve 对
      // Range 回 200 全量实测 2026-11-02——Range 语义乱套会卡死分片重试）
      if (f.bytes < 4 * 1024 * 1024 || !rangeOk) {
        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(120000) });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const bytes = new Uint8Array(await resp.arrayBuffer());
          const actual = sha256(bytes);
          if (actual !== f.sha256) throw new Error(`sha mismatch ${actual.slice(0, 12)}…`);
          writeFileSync(p, bytes);
          console.log(`  ✓ ${f.path}（${(f.bytes / 1048576).toFixed(1)}MB via ${s.id} 直取${rangeOk ? "" : "·200源"}）`);
          done = true;
        } catch (e) {
          lastErr = e;
          console.warn(`  · 源 ${s.id} 直取失败: ${e.message}`);
        }
        if (done) break;
        continue;
      }
      try {
        mkdirSync(join(CACHE_DIR, ".chunks"), { recursive: true }); // FsChunkStore 原子写前置
        const dl = new core.Download(
          {
            ghUrl: url,
            name: f.path.replace(/\//g, "__"), // 块仓键只在本任务内唯一即可
            size: f.bytes,
            expectedSha256: f.sha256,
            sources: [new core.Source(s.id, (u) => u)],
            appId: `audio-model-${m.root}`,
          },
          {
            fetch: (u, init) => fetch(u, init),
            store: new core.FsChunkStore(join(CACHE_DIR, ".chunks")),
            timer: { now: () => performance.now(), epoch: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
            abort: {
              any: (signals) => AbortSignal.any(signals.filter(Boolean)),
              timeout: (ms) => AbortSignal.timeout(ms),
            },
            random: Math.random,
          },
        );
        dl.onProgress?.(() => {});
        const r = await dl.run().catch((e) => { console.warn(`  · run 异常: ${e.message}`); throw e; });
        if (r !== "done") throw new Error(`run=${r}`);
        const v = await dl.verifySha256();
        if (v.status !== "match") throw new Error(`sha ${v.status}`);
        const bytes = await dl.assembleBytes();
        writeFileSync(p, bytes);
        const re = verifyOne(m, f);
        if (!re.ok) throw new Error(`落盘复核失败: ${re.reason}`);
        console.log(`  ✓ ${f.path}（${(f.bytes / 1048576).toFixed(1)}MB via ${s.id}）`);
        done = true;
        break;
      } catch (e) {
        lastErr = e;
        console.warn(`  · 源 ${s.id} 失败: ${e.message}`);
      }
    }
    if (!done) {
      console.error(`  ✗ ${f.path}: 全源失败（最后: ${lastErr?.message}）`);
      failures++;
    }
  }
}

if (failures) {
  console.error(`\n✗ ${failures} 个文件未就位`);
  process.exit(1);
}
console.log("\n✓ 全部模型就位（.models-cache，sha256 全对）");
