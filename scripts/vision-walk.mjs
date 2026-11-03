/* 7.3 vision walkthrough：两站截图产图（浅/深＋终态）＋黑图防线 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = await import("playwright-core");

const ROOT = dirname(fileURLToPath(import.meta.url)) + "/..";
const CACHE = join(ROOT, ".models-cache");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".wav": "audio/wav", ".mjs": "text/javascript", ".txt": "text/plain" };

function serve(dist) {
  const server = createServer((hreq, res) => {
    const url = decodeURIComponent(new URL(hreq.url, "http://x").pathname);
    const m = url.match(/^\/model\/([^/]+)\/([^/]+)\/resolve\/main\/(.+)$/);
    if (m) {
      const upstream = `${m[1]}/${m[2]}`;
      const rootMap = { "onnx-community/whisper-base": "whisper-base-q8" }[upstream];
      if (rootMap) {
        const p = normalize(join(CACHE, rootMap, m[3]));
        if (p.startsWith(CACHE) && existsSync(p) && statSync(p).isFile()) { res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" }); res.end(readFileSync(p)); return; }
      }
    }
    const dm = url.match(/^\/models\/([^/]+)\/(.+)$/);
    if (dm) {
      const p = normalize(join(CACHE, dm[1], dm[2]));
      if (p.startsWith(CACHE) && existsSync(p) && statSync(p).isFile()) { res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" }); res.end(readFileSync(p)); return; }
    }
    if (url === "/sample.wav") { res.writeHead(200, { "content-type": "audio/wav" }); res.end(readFileSync(join(CACHE, "sense-voice-int8-2024-07-17/test_wavs/zh.wav"))); return; }
    const p = normalize(join(dist, url === "/" ? "index.html" : url));
    if (!p.startsWith(dist) || !existsSync(p) || !statSync(p).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

const chrome = [
  process.env.VISION_CHROME,
  join(process.env.HOME ?? "", "Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
  join(process.env.HOME ?? "", "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
].filter((p) => p && existsSync(p))[0];
const browser = await chromium.launch({ executablePath: chrome, headless: true });

async function blackCheck(name, file) {
  const st = statSync(file);
  if (st.size < 2000) { console.log(`[black-check] ${name}: FAIL（文件过小 ${st.size}B＝疑似空白图）`); return false; }
  // 采样 PNG 尾部（IDAT 压缩——不做全解码，用「大小合理＋非空」启发＋PNG 头）
  const head = readFileSync(file).slice(0, 8);
  const isPng = head.toString("hex").startsWith("89504e47");
  console.log(`[black-check] ${name}: ${isPng && st.size > 20000 ? "PASS" : "WARN"}（${(st.size / 1024).toFixed(0)}KB, png=${isPng}）`);
  return isPng && st.size > 20000;
}

/* ── audio-tts ── */
{
  const server = await serve(join(ROOT, "apps/audio-tts/dist"));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + "/", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/vision-audio/tts-01-load-light.png", fullPage: true });
  console.log("[tts] load:", await page.evaluate(() => document.getElementById("status")?.textContent));

  // 音色 Select 展开（103 项弹层）
  await page.click("#voice-select");
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/vision-audio/tts-02-select-open.png" });
  const optionCount = await page.evaluate(() => document.querySelectorAll("[data-slot='select-item'], [role='option']").length);
  console.log("[tts] select options visible:", optionCount);
  await page.keyboard.press("Escape");

  // 合成（textarea 已有 defaultValue；再 programmatic 确认）
  await page.evaluate(() => { const el = document.getElementById("input-text"); el.value = "你好，本地语音合成测试。今天天气不错。"; });
  await page.click("#generate-btn");
  let final = "";
  for (let i = 0; i < 300; i++) {
    await page.waitForTimeout(1000);
    final = await page.evaluate(() => document.getElementById("status")?.textContent ?? "");
    if (i % 10 === 0) console.log(`[tts] poll ${i}:`, final);
    if (/已合成|失败/.test(final)) break;
  }
  // 合成中（进度）截一张：在轮询早期抓（如还没到终态）
  await page.screenshot({ path: "/tmp/vision-audio/tts-03-final.png", fullPage: true });
  console.log("[tts] final:", final);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/vision-audio/tts-04-dark.png", fullPage: true });
  await page.close();
  server.close();
}

/* ── audio-stt ── */
{
  const server = await serve(join(ROOT, "apps/audio-stt/dist"));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + "/", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/vision-audio/stt-01-load-light.png", fullPage: true });
  console.log("[stt] load:", await page.evaluate(() => document.getElementById("status")?.textContent));

  // 挂样例文件
  await page.evaluate(async () => {
    const resp = await fetch("/sample.wav");
    const blob = await resp.blob();
    const file = new File([blob], "zh.wav", { type: "audio/wav" });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.getElementById("input-file").files = dt.files;
  });
  await page.click("#transcribe-btn");
  let final = "";
  for (let i = 0; i < 300; i++) {
    await page.waitForTimeout(1000);
    final = await page.evaluate(() => document.getElementById("status")?.textContent ?? "");
    if (i % 10 === 0) console.log(`[stt] poll ${i}:`, final);
    if (/已转写|失败/.test(final)) break;
  }
  await page.screenshot({ path: "/tmp/vision-audio/stt-02-final.png", fullPage: true });
  console.log("[stt] final:", final);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/vision-audio/stt-03-dark.png", fullPage: true });
  await page.close();
  server.close();
}

await browser.close();
for (const f of ["tts-01-load-light", "tts-02-select-open", "tts-03-final", "tts-04-dark", "stt-01-load-light", "stt-02-final", "stt-03-dark"]) {
  blackCheck(f, `/tmp/vision-audio/${f}.png`);
}
console.log("WALK DONE");
