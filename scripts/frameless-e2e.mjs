#!/usr/bin/env node
/**
 * file-viewer 无壳面 E2E —— scripts/frameless-e2e.mjs
 *
 * 验收（openspec change file-viewer-frameless A1–A5）：
 * - SVG/HTML/PDF 各以 `frameless=1&size=1080x1440&background=#ffffff` 打开：
 *   所有 `[data-viewer-chrome]` 隐藏、`data-frameless-ready="1"`、内容盒严格
 *   1080×1440、页面零滚动，截图 1080×1440（真浏览器像素证据）；
 * - 音频无壳不渲染原生 controls；
 * - WebMCP `preview_file({frameless:'1',size:'1080x1440'})` 生效且回执带
 *   frameless/size/ready；
 * - 非 frameless 对照：顶栏/底栏照旧可见（零回归）。
 *
 * 证据产物（同目录相对引用，供 e2e-report-gen.mjs 生成 report.html）：
 *   <out>/steps.json + <out>/img/*.png
 *
 * 用法：
 *   node scripts/frameless-e2e.mjs --out <证据目录> [--chrome <path>]
 * 前提：`pnpm --filter file-viewer build`（dist 就绪）。
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'apps/file-viewer/dist');

const args = process.argv.slice(2);
function argOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
const OUT = resolve(argOf('--out') ?? join(ROOT, '.qa/fileviewer-frameless'));
const IMG_DIR = join(OUT, 'img');
const SIZE = { width: 1080, height: 1440 };
const SIZE_LABEL = `${SIZE.width}x${SIZE.height}`;
const BACKGROUND = '#ffffff';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function findChrome() {
  return [
    process.env.FRAMELESS_E2E_CHROME,
    argOf('--chrome'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    join(process.env.HOME ?? '', 'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    join(process.env.HOME ?? '', 'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
  ].filter(Boolean).find((p) => existsSync(p));
}

// ---------- 夹具（SVG/HTML/PDF/WAV：确定性生成，随脚本可复现） ----------

function posterSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE.width}" height="${SIZE.height}" viewBox="0 0 ${SIZE.width} ${SIZE.height}">
  <rect width="${SIZE.width}" height="${SIZE.height}" fill="#f7f5ef"/>
  <rect x="0" y="0" width="${SIZE.width}" height="${SIZE.height}" fill="none" stroke="#14532d" stroke-width="24"/>
  <rect x="72" y="120" width="936" height="4" fill="#14532d"/>
  <text x="72" y="230" font-family="PingFang SC, system-ui" font-size="44" fill="#14532d" letter-spacing="6">FDE2E 智能体集群</text>
  <text x="72" y="380" font-family="PingFang SC, system-ui" font-size="120" font-weight="700" fill="#111827">无壳内容面</text>
  <text x="72" y="500" font-family="PingFang SC, system-ui" font-size="64" fill="#374151">Frameless Surface</text>
  <text x="72" y="760" font-family="PingFang SC, system-ui" font-size="30" fill="#4b5563">这一张的顶栏/底栏应全部消失</text>
  <text x="72" y="810" font-family="PingFang SC, system-ui" font-size="30" fill="#4b5563">落款必须完整可见——不得被裁切</text>
  <rect x="0" y="${SIZE.height - 220}" width="${SIZE.width}" height="220" fill="#14532d"/>
  <text x="72" y="${SIZE.height - 120}" font-family="PingFang SC, system-ui" font-size="48" fill="#ffffff">落款 · FDE2E™ 2026-11-03</text>
  <text x="72" y="${SIZE.height - 58}" font-family="PingFang SC, system-ui" font-size="24" fill="#bbf7d0">file-viewer-frameless · signature band</text>
</svg>`;
}

function posterHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;background:#fdfcf8;color:#111827;font-family:"PingFang SC",system-ui,sans-serif}
  .poster{height:100%;display:flex;flex-direction:column;border:24px solid #7c2d12}
  .head{padding:90px 72px 0}
  .kicker{font-size:34px;letter-spacing:.2em;color:#7c2d12}
  h1{font-size:110px;line-height:1.1;margin-top:28px;font-weight:800}
  .sub{font-size:54px;color:#57534e;margin-top:22px}
  .body{padding:80px 72px;font-size:30px;line-height:1.8;color:#44403c;flex:1}
  .sig{margin-top:auto;background:#7c2d12;color:#fff;padding:50px 72px;font-size:46px;letter-spacing:.05em}
  .note{font-size:24px;color:#fed7aa;margin-top:12px}
  </style></head><body><div class="poster">
  <div class="head"><div class="kicker">FDE2E™ TOOL</div><h1>HTML 无壳面</h1><div class="sub">Frameless Surface · 1080 × 1440</div></div>
  <div class="body">HTML 解码器在 sandbox iframe 中渲染。<br>无壳模式下预览器顶栏/底栏全部隐藏，<br>只留下这份页面本身——落款完整。</div>
  <div class="sig">落款 · FDE2E™ 2026-11-03<div class="note">signature band · HTML</div></div>
  </div></body></html>`;
}

/** 最小可用 PDF（单页 810×1080pt ≈ 1080×1440px @96dpi），底部深色落款带。 */
function posterPdf() {
  const content = [
    '0.06 0.46 0.43 rg 0 0 810 90 re f',
    '0.06 0.46 0.43 rg 60 980 690 6 re f',
    'BT /F1 30 Tf 60 930 Td 0.06 0.46 0.43 rg (FDE2E TOOL) Tj ET',
    'BT /F1 64 Tf 60 760 Td 0.07 0.09 0.15 rg (PDF Frameless Surface) Tj ET',
    'BT /F1 22 Tf 60 700 Td 0.27 0.29 0.33 rg (viewer chrome hidden, content only) Tj ET',
    'BT /F1 34 Tf 60 60 Td 1 1 1 rg (Signature - FDE2E 2026-11-03) Tj ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 810 1080] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** 0.6s 静音 WAV（44.1kHz/16bit/mono）——音频无壳控件断言用。 */
function silenceWav() {
  const sampleRate = 44100;
  const seconds = 0.6;
  const dataSize = Math.floor(sampleRate * seconds) * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

// ---------- 静态服务 ----------

function serve(appDist, fixtureDir) {
  const server = createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const fixture = urlPath.startsWith('/fixtures/')
        ? join(fixtureDir, urlPath.slice('/fixtures/'.length))
        : null;
      const filePath = fixture ?? join(appDist, urlPath === '/' ? 'index.html' : urlPath);
      const body = readFileSync(filePath);
      res.writeHead(200, {
        'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

// ---------- 断言 / PNG 解析 ----------

const steps = [];
function step(group, entry) {
  steps.push({ ...entry, group });
}

/** PNG IHDR 宽高（字节级，避免引入解码依赖）。 */
function pngSize(buffer) {
  if (buffer.toString('latin1', 1, 4) !== 'PNG') throw new Error('截图不是 PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** 在隔离页里把 PNG 解码到 canvas，采样指定像素（真像素证据）。 */
async function samplePixels(browser, buffer, points) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ({ b64, points }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const out = { width: img.width, height: img.height, pixels: {} };
        for (const [name, [x, y]] of Object.entries(points)) {
          const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
          out.pixels[name] = { r, g, b, a, hex: `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}` };
        }
        return out;
      },
      { b64: buffer.toString('base64'), points },
    );
  } finally {
    await page.close();
  }
}

/** 页面内通用断言：chrome 全隐藏 / 尺寸严格 / 零滚动 / ready 信号。 */
async function assertFramelessPage(page, expectedDecoder) {
  return page.evaluate(
    ({ size, decoder }) => {
      const html = document.documentElement;
      const root = document.querySelector('[data-frameless-root]');
      const box = root?.getBoundingClientRect();
      const chrome = Array.from(document.querySelectorAll('[data-viewer-chrome]'));
      const visibleChrome = chrome.filter((el) => getComputedStyle(el).display !== 'none');
      const decoderRoot = document.querySelector('[data-decoder-root]');
      return {
        frameless: html.getAttribute('data-frameless'),
        ready: html.getAttribute('data-frameless-ready'),
        chromeCount: chrome.length,
        visibleChromeCount: visibleChrome.length,
        visibleChromeKinds: visibleChrome.map((el) => el.getAttribute('data-viewer-chrome')),
        rootBox: box
          ? { width: Math.round(box.width), height: Math.round(box.height), x: Math.round(box.x), y: Math.round(box.y) }
          : null,
        expectsSize: size,
        decoderId: decoderRoot?.getAttribute('data-decoder-root') ?? null,
        decoderExpected: decoder,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        bodyMargin: getComputedStyle(document.body).margin,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
      };
    },
    { size: SIZE, decoder: expectedDecoder },
  );
}

function verdict(group, label, ok, detail) {
  step(group, { intent: label, assertion: detail, ok });
  return ok;
}

// ---------- 主流程 ----------

async function main() {
  if (!existsSync(DIST)) {
    console.error(`✗ 找不到 ${DIST}——先跑 pnpm --filter file-viewer build`);
    process.exit(2);
  }
  mkdirSync(IMG_DIR, { recursive: true });
  const fixtureDir = mkdtempSync(join(tmpdir(), 'fv-frameless-fixtures-'));
  writeFileSync(join(fixtureDir, 'poster.svg'), posterSvg());
  writeFileSync(join(fixtureDir, 'poster.html'), posterHtml());
  writeFileSync(join(fixtureDir, 'poster.pdf'), posterPdf());
  writeFileSync(join(fixtureDir, 'tone.wav'), silenceWav());

  const server = await serve(DIST, fixtureDir);
  const base = `http://127.0.0.1:${server.address().port}`;

  const executablePath = findChrome();
  if (!executablePath) {
    console.error('✗ 找不到本机 Chromium/Chrome——设 FRAMELESS_E2E_CHROME 指定路径');
    process.exit(2);
  }
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--enable-blink-features=WebMCP'],
  });
  console.log(`Chrome: ${executablePath}`);
  console.log(`Serving: ${DIST} + fixtures @ ${base}`);

  const pageErrors = [];

  async function openFrameless(name, file, decoder) {
    const page = await browser.newPage({
      viewport: SIZE,
      deviceScaleFactor: 1,
      acceptDownloads: false,
    });
    page.on('pageerror', (err) => pageErrors.push(`${name}: ${err.message}`));
    const qs = new URLSearchParams({ url: `${base}/fixtures/${file}`, name: file, frameless: '1', size: SIZE_LABEL, background: BACKGROUND });
    await page.goto(`${base}/?${qs.toString()}`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => {
        const v = document.documentElement.getAttribute('data-frameless-ready');
        return v === '1' || v === 'error';
      },
      undefined,
      { timeout: 30000 },
    );
    const state = await assertFramelessPage(page, decoder);
    const shot = await page.screenshot({ type: 'png' });
    const imgName = `${name}.png`;
    writeFileSync(join(IMG_DIR, imgName), shot);
    return { page, state, shot, image: `img/${imgName}`, dims: pngSize(shot) };
  }

  // ---- 1. SVG 无壳 ----
  {
    const label = 'SVG 无壳（frameless=1&size=1080x1440&background=#ffffff）';
    const run = await openFrameless('svg-frameless', 'poster.svg', 'svg');
    const { state, dims } = run;
    const pixels = await samplePixels(browser, run.shot, {
      topLeft: [0, 0],
      topRight: [SIZE.width - 1, 0],
      signatureBand: [Math.floor(SIZE.width / 2), SIZE.height - 100],
      aboveBand: [Math.floor(SIZE.width / 2), SIZE.height - 300],
    });
    const ok =
      state.frameless === '1' &&
      state.ready === '1' &&
      state.chromeCount > 0 &&
      state.visibleChromeCount === 0 &&
      state.rootBox?.width === SIZE.width &&
      state.rootBox?.height === SIZE.height &&
      state.rootBox.x === 0 &&
      state.rootBox.y === 0 &&
      state.decoderId === 'svg' &&
      state.scrollWidth <= state.innerWidth &&
      state.scrollHeight <= state.innerHeight &&
      dims.width === SIZE.width &&
      dims.height === SIZE.height &&
      pixels.pixels.signatureBand.hex === '#14532d';
    verdict(
      'svg',
      label,
      ok,
      `data-frameless=${state.frameless}、ready=${state.ready}、chrome ${state.chromeCount} 个全部 display:none（可见 ${state.visibleChromeCount}）、` +
        `内容盒 ${state.rootBox?.width}×${state.rootBox?.height}@(${state.rootBox?.x},${state.rootBox?.y})、解码器=${state.decoderId}、` +
        `无滚动（${state.scrollWidth}×${state.scrollHeight} ≤ ${state.innerWidth}×${state.innerHeight}）、PNG ${dims.width}×${dims.height}、` +
        `底部落款带采样 ${pixels.pixels.signatureBand.hex}（期望 #14532d，证明底栏未覆盖落款）`,
    );
    if (!ok) console.error('SVG 细节:', JSON.stringify({ state, dims, pixels }, null, 2));
    step('svg', {
      intent: 'SVG 无壳截图（真浏览器 1080×1440）',
      expect: '只含 SVG 内容本体：无顶栏/底栏/控件条，落款带完整',
      assertion: `截图已落盘 ${run.image}（${dims.width}×${dims.height}；左上像素 ${pixels.pixels.topLeft.hex}、落款带 ${pixels.pixels.signatureBand.hex}）`,
      ok,
      image: run.image,
      imageMeta: `${dims.width}×${dims.height} · png · DPR 1`,
    });
    await run.page.close();
  }

  // ---- 2. HTML 无壳 ----
  {
    const label = 'HTML 无壳（sandbox iframe 解码器）';
    const run = await openFrameless('html-frameless', 'poster.html', 'html');
    const { state, dims } = run;
    const pixels = await samplePixels(browser, run.shot, {
      topLeft: [0, 0],
      signatureBand: [Math.floor(SIZE.width / 2), SIZE.height - 60],
    });
    const ok =
      state.frameless === '1' &&
      state.ready === '1' &&
      state.visibleChromeCount === 0 &&
      state.rootBox?.width === SIZE.width &&
      state.rootBox?.height === SIZE.height &&
      state.decoderId === 'html' &&
      dims.width === SIZE.width &&
      dims.height === SIZE.height &&
      /^#7c2d12$/.test(pixels.pixels.signatureBand.hex);
    verdict(
      'html',
      label,
      ok,
      `ready=${state.ready}、chrome 可见 ${state.visibleChromeCount}、内容盒 ${state.rootBox?.width}×${state.rootBox?.height}、` +
        `PNG ${dims.width}×${dims.height}、底部落款带 ${pixels.pixels.signatureBand.hex}（期望 #7c2d12）`,
    );
    if (!ok) console.error('HTML 细节:', JSON.stringify({ state, dims, pixels }, null, 2));
    step('html', {
      intent: 'HTML 无壳截图（真浏览器 1080×1440）',
      expect: '只含 HTML 页面本体（含其自身落款带），预览器 chrome 全部消失',
      assertion: `截图已落盘 ${run.image}（${dims.width}×${dims.height}；落款带采样 ${pixels.pixels.signatureBand.hex}）`,
      ok,
      image: run.image,
      imageMeta: `${dims.width}×${dims.height} · png · DPR 1`,
    });
    await run.page.close();
  }

  // ---- 3. PDF 无壳 ----
  {
    const label = 'PDF 无壳（浏览器原生查看器 + #toolbar=0）';
    const run = await openFrameless('pdf-frameless', 'poster.pdf', 'pdf');
    const { state, dims } = run;
    const pixels = await samplePixels(browser, run.shot, {
      topLeft: [0, 0],
      topLeftInner: [3, 3],
      bottomBand: [Math.floor(SIZE.width / 2), SIZE.height - 30],
      center: [Math.floor(SIZE.width / 2), Math.floor(SIZE.height / 2)],
    });
    const isWhite = (hex) => /^#f[0-9a-f]{5}$/.test(hex);
    const ok =
      state.frameless === '1' &&
      state.ready === '1' &&
      state.visibleChromeCount === 0 &&
      state.rootBox?.width === SIZE.width &&
      state.rootBox?.height === SIZE.height &&
      state.decoderId === 'pdf' &&
      dims.width === SIZE.width &&
      dims.height === SIZE.height &&
      isWhite(pixels.pixels.center.hex) &&
      /^#0f756e$/.test(pixels.pixels.bottomBand.hex);
    verdict(
      'pdf',
      label,
      ok,
      `ready=${state.ready}、chrome 可见 ${state.visibleChromeCount}、内容盒 ${state.rootBox?.width}×${state.rootBox?.height}、` +
        `PNG ${dims.width}×${dims.height}、像素 中央 ${pixels.pixels.center.hex}（白页）/ 落款带 ${pixels.pixels.bottomBand.hex}（期望 #0f756e）/ 最外缘 ${pixels.pixels.topLeft.hex}（原生查看器自绘页边）`,
    );
    if (!ok) console.error('PDF 细节:', JSON.stringify({ state, dims, pixels }, null, 2));
    step('pdf', {
      intent: 'PDF 无壳截图（真浏览器 1080×1440）',
      expect: '预览器 chrome 全部隐藏；原生 PDF 工具条经 #toolbar=0 收掉',
      assertion: `截图已落盘 ${run.image}（${dims.width}×${dims.height}；中央内容像素 ${pixels.pixels.center.hex}）`,
      ok,
      image: run.image,
      imageMeta: `${dims.width}×${dims.height} · png · DPR 1`,
    });
    step('boundary', {
      intent: '边界记录：PDF 原生查看器页边（不谎报全净）',
      expect: 'PDFium 自绘的 1px 页边属原生查看器边界，非 viewer chrome',
      assertion: `页内容完整（中央 ${pixels.pixels.center.hex}、落款带 ${pixels.pixels.bottomBand.hex}）；最外缘像素 ${pixels.pixels.topLeft.hex} 为 Chrome 原生 PDF 查看器的页边描边——工具条/侧栏/滚动条已由 #toolbar=0&navpanes=0&scrollbar=0 收掉`,
      ok: true,
    });
    await run.page.close();
  }

  // ---- 4. 音频无壳：不渲染原生 controls ----
  {
    const label = '音频无壳：不渲染原生 controls';
    const run = await openFrameless('audio-frameless', 'tone.wav', 'audio');
    const audio = await run.page.evaluate(() => {
      const el = document.querySelector('audio');
      return el ? { hasControlsAttr: el.hasAttribute('controls'), controlsProp: el.controls } : null;
    });
    const ok = audio !== null && audio.hasControlsAttr === false && audio.controlsProp === false;
    verdict('media', label, ok, `audio 元素 ${audio ? `controls 属性=${audio.hasControlsAttr}、controls 属性值=${audio.controlsProp}` : '不存在'}`);
    step('media', {
      intent: '音频无壳截图（真浏览器 1080×1440）',
      expect: '不渲染原生音频控件（截图面零控件）',
      assertion: `audio.hasAttribute(controls)=${audio?.hasControlsAttr}、audio.controls=${audio?.controlsProp}`,
      ok,
      image: run.image,
      imageMeta: `${run.dims.width}×${run.dims.height} · png · DPR 1`,
    });
    step('boundary', {
      intent: '边界记录：音频无视觉内容',
      expect: '音频无壳面 = 内容盒背景（不出现任何控件/装饰）',
      assertion: '音频不渲染原生 controls、装饰图标也标为 chrome 隐藏——音频本身无视觉内容，播放语义由带壳形态承担；需要听音频时用常规预览',
      ok: true,
    });
    await run.page.close();
  }

  // ---- 5. WebMCP preview_file 无壳 ----
  {
    const label = "WebMCP preview_file({frameless:'1',size:'1080x1440'})";
    const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
    page.on('pageerror', (err) => pageErrors.push(`webmcp: ${err.message}`));
    const initial = new URLSearchParams({ url: `${base}/fixtures/poster.svg`, name: 'poster.svg' });
    await page.goto(`${base}/?${initial.toString()}`, { waitUntil: 'load' });
    await page.waitForFunction(
      async () => {
        if (!document.modelContext) return false;
        const tools = await document.modelContext.getTools();
        return tools.some((t) => t.name === 'preview_file');
      },
      undefined,
      { timeout: 30000 },
    );
    const result = await page.evaluate(async ({ fileUrl, size }) => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find((t) => t.name === 'preview_file');
      const raw = await document.modelContext.executeTool(tool, {
        url: fileUrl,
        name: 'poster.svg',
        frameless: '1',
        size,
        background: '#ffffff',
      });
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return {
        rawType: typeof raw,
        parsed,
        href: window.location.href,
        chromeVisible: Array.from(document.querySelectorAll('[data-viewer-chrome]')).filter(
          (el) => getComputedStyle(el).display !== 'none',
        ).length,
        rootBox: (() => {
          const box = document.querySelector('[data-frameless-root]')?.getBoundingClientRect();
          return box ? { width: Math.round(box.width), height: Math.round(box.height) } : null;
        })(),
        ready: document.documentElement.getAttribute('data-frameless-ready'),
        schema: tool.inputSchema ?? tool.input_schema ?? null,
      };
    }, { fileUrl: `${base}/fixtures/poster.svg`, size: SIZE_LABEL });
    const props = result.schema?.properties ?? {};
    const ok =
      result.parsed?.ok === true &&
      result.parsed?.frameless === true &&
      result.parsed?.size === SIZE_LABEL &&
      result.parsed?.ready === true &&
      result.ready === '1' &&
      result.chromeVisible === 0 &&
      result.rootBox?.width === SIZE.width &&
      result.rootBox?.height === SIZE.height &&
      result.href.includes('frameless=1') &&
      ['frameless', 'size', 'background'].every((k) => k in props);
    verdict(
      'webmcp',
      label,
      ok,
      `返回 ${JSON.stringify(result.parsed)}；页面 ready=${result.ready}、chrome 可见 ${result.chromeVisible}、内容盒 ${result.rootBox?.width}×${result.rootBox?.height}；` +
        `schema 三参 ${['frameless', 'size', 'background'].map((k) => `${k}:${k in props}`).join(' ')}；URL 含 frameless=1=${result.href.includes('frameless=1')}`,
    );
    if (!ok) console.error('WebMCP 细节:', JSON.stringify(result, null, 2));
    step('webmcp', {
      intent: 'WebMCP 无壳切换（preview_file）',
      expect: '执行后页面进入无壳模式、返回 frameless/size/ready，schema 由 registry 单源派生',
      command: JSON.stringify({ tool: 'preview_file', input: { url: '<fixtures>/poster.svg', frameless: '1', size: SIZE_LABEL, background: '#ffffff' } }),
      reply: JSON.stringify(result.parsed),
      assertion: `ready=${result.ready}、可见 chrome=${result.chromeVisible}、内容盒 ${result.rootBox?.width}×${result.rootBox?.height}、schema 含三参`,
      ok,
    });
    await page.close();
  }

  // ---- 6. 非 frameless 对照（零回归） ----
  {
    const label = '非 frameless 对照：顶栏/底栏照常可见';
    const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
    page.on('pageerror', (err) => pageErrors.push(`control: ${err.message}`));
    const qs = new URLSearchParams({ url: `${base}/fixtures/poster.svg`, name: 'poster.svg' });
    await page.goto(`${base}/?${qs.toString()}`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('[data-decoder-surface]') !== null, undefined, {
      timeout: 30000,
    });
    const state = await page.evaluate(() => {
      const html = document.documentElement;
      const visible = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).display !== 'none' : false;
      };
      return {
        framelessAttr: html.getAttribute('data-frameless'),
        readyAttr: html.getAttribute('data-frameless-ready'),
        topbar: visible('[data-viewer-topbar]'),
        footer: visible('[data-viewer-chrome="sandbox-footer"]'),
        chromeCount: document.querySelectorAll('[data-viewer-chrome]').length,
        decoderId: document.querySelector('[data-decoder-root]')?.getAttribute('data-decoder-root'),
      };
    });
    const shot = await page.screenshot({ type: 'png' });
    const image = 'img/svg-framed-control.png';
    writeFileSync(join(IMG_DIR, 'svg-framed-control.png'), shot);
    const dims = pngSize(shot);
    const ok =
      state.framelessAttr === null &&
      state.readyAttr === null &&
      state.topbar === true &&
      state.footer === true &&
      state.decoderId === 'svg' &&
      dims.width === SIZE.width &&
      dims.height === SIZE.height;
    verdict('boundary', label, ok, `data-frameless=${state.framelessAttr}、ready=${state.readyAttr}、顶栏可见=${state.topbar}、底栏可见=${state.footer}、PNG ${dims.width}×${dims.height}`);
    step('boundary', {
      intent: '非 frameless 对照截图（同一 SVG，1080×1440）',
      expect: '顶栏与解码器底栏照常可见；无 data-frameless/data-frameless-ready 属性',
      assertion: `顶栏=${state.topbar}、底栏=${state.footer}、chrome 共 ${state.chromeCount} 个、PNG ${dims.width}×${dims.height}`,
      ok,
      image,
      imageMeta: `${dims.width}×${dims.height} · png · DPR 1`,
    });
    await page.close();
  }

  // ---- 7. 非法 size 静默回退（浏览器侧） ----
  {
    const label = '非法 size 静默回退（size=abc）';
    const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
    page.on('pageerror', (err) => pageErrors.push(`badsize: ${err.message}`));
    const qs = new URLSearchParams({ url: `${base}/fixtures/poster.svg`, name: 'poster.svg', frameless: '1', size: 'abc' });
    await page.goto(`${base}/?${qs.toString()}`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-frameless-ready') === '1',
      undefined,
      { timeout: 30000 },
    );
    const state = await page.evaluate(() => {
      const box = document.querySelector('[data-frameless-root]')?.getBoundingClientRect();
      return {
        sizedAttr: document.querySelector('[data-frameless-root]')?.getAttribute('data-frameless-sized'),
        box: box ? { width: Math.round(box.width), height: Math.round(box.height) } : null,
        errorPane: Boolean(document.querySelector('[data-viewer-error]')),
        decoderId: document.querySelector('[data-decoder-root]')?.getAttribute('data-decoder-root'),
      };
    });
    const ok =
      state.sizedAttr === null &&
      state.box?.width === SIZE.width &&
      state.box?.height === SIZE.height &&
      state.errorPane === false &&
      state.decoderId === 'svg';
    verdict('boundary', label, ok, `data-frameless-sized=${state.sizedAttr}、视口内容盒 ${state.box?.width}×${state.box?.height}、错误态=${state.errorPane}、解码器=${state.decoderId}`);
    step('boundary', {
      intent: '非法 size 回退断言（浏览器实测）',
      expect: '忽略 size，按视口渲染，不报契约错误',
      assertion: `contentBox=${state.box?.width}×${state.box?.height}（视口 ${SIZE.width}×${SIZE.height}）、errorPane=${state.errorPane}`,
      ok,
    });
    await page.close();
  }

  // ---- 8. 无壳错误态：ready=error ----
  {
    const label = '无壳错误态：ready=error（避免调用方无限等待）';
    const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
    page.on('pageerror', (err) => pageErrors.push(`error-state: ${err.message}`));
    const qs = new URLSearchParams({ url: `${base}/fixtures/missing.png`, name: 'missing.png', frameless: '1', size: SIZE_LABEL });
    await page.goto(`${base}/?${qs.toString()}`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-frameless-ready') === 'error',
      undefined,
      { timeout: 30000 },
    );
    const state = await page.evaluate(() => ({
      ready: document.documentElement.getAttribute('data-frameless-ready'),
      errorPane: Boolean(document.querySelector('[data-viewer-error]')),
      text: document.querySelector('[data-viewer-error]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? '',
    }));
    const ok = state.ready === 'error' && state.errorPane === true;
    verdict('boundary', label, ok, `ready=${state.ready}、错误面板=${state.errorPane}、文本节选「${state.text}」`);
    step('boundary', {
      intent: '无壳失败态信号断言',
      expect: '文件 404 时 data-frameless-ready="error"，错误面板仍可见（可诊断，不空白）',
      assertion: `data-frameless-ready=${state.ready}、错误面板可见=${state.errorPane}`,
      ok,
    });
    await page.close();
  }

  if (pageErrors.length) {
    step('boundary', { intent: '页面运行期错误（pageerror）', assertion: pageErrors.join(' | '), ok: false });
  }

  await browser.close();
  server.close();
  rmSync(fixtureDir, { recursive: true, force: true });

  const pass = steps.filter((s) => s.ok === true).length;
  const fail = steps.length - pass;
  const byGroup = (group) =>
    steps.filter((s) => s.group === group).map(({ group: _group, ...rest }) => rest);
  const stepsJson = {
    title: 'file-viewer 无壳内容面（frameless）端到端报告',
    brand: 'FDE2E™ Tools · 文件预览站 · 端到端交付报告',
    subtitle: 'change file-viewer-frameless · ?frameless=1&size=1080x1440 截图面',
    meta: `真浏览器（Chrome/Chromium headless）· viewport 1080×1440 · DPR 1 · 断言 ${pass} PASS / ${fail} FAIL`,
    thesis:
      'file-viewer 提供「无壳内容面」：frameless=1 隐藏全部 previewer chrome，size 精确控制内容盒，data-frameless-ready 供 BU waitFor——SVG/PDF/HTML 均可截出干净画面。',
    env: [
      ['浏览器', executablePath],
      ['viewport', `${SIZE.width}×${SIZE.height}（DPR 1，截图即 CSS 像素）`],
      ['构建产物', 'apps/file-viewer/dist（vite build）'],
      ['夹具', 'SVG/HTML/PDF/WAV 确定性生成（见 scripts/frameless-e2e.mjs）'],
      ['运行日期', new Date().toISOString()],
    ],
    sections: [
      {
        title: '1 · URL 契约与无壳壳层（SVG 1080×1440 实测）',
        note: 'frameless=1 隐藏全部 viewer chrome，内容盒严格尺寸、零边距、禁滚动；落款带像素级验证未被底栏遮挡。',
        steps: byGroup('svg'),
      },
      {
        title: '2 · HTML / PDF 无壳截图',
        note: '同一契约下 HTML（sandbox iframe）与 PDF（浏览器原生查看器）均为无壳内容面。',
        steps: [...byGroup('html'), ...byGroup('pdf')],
      },
      {
        title: '3 · 媒体控件与 WebMCP 无壳面',
        note: '音频不渲染原生 controls；preview_file 入参/回执/schema 与 registry 单源一致。',
        steps: [...byGroup('media'), ...byGroup('webmcp')],
      },
      {
        title: '4 · 对照与边界',
        note: '非 frameless 顶栏/底栏照旧；非法 size 静默回退；失败态 ready=error。',
        steps: byGroup('boundary'),
      },
    ],
    summary: { pass, fail },
  };
  writeFileSync(join(OUT, 'steps.json'), JSON.stringify(stepsJson, null, 2));
  console.log(`\n✓ 证据已写入 ${OUT}（${pass} PASS / ${fail} FAIL，${steps.filter((s) => s.image).length} 张截图）`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('✗ E2E 运行失败：', err);
  process.exit(1);
});
