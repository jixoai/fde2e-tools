/*
 * 画布绘制层 —— apps/img-tool/src/painter.ts
 *
 * 迁移自原单文件 index.html 的绘制逻辑，算法逐字保留：
 * - 参数解析语义（clamp/默认值/校验正则）不变——URL 参数契约已有智能体在用；
 * - 内置示例底图（运行时绘制 → data URL，离线可复现）逐笔画一致；
 * - cover 缩放/文字块/角标绘制与状态信息结构不变。
 */
export const FONT_STACK =
  '-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI","Microsoft YaHei",sans-serif';

export const CORS_MSG = "该图源不允许跨域读取，请先把图转入素材库再用其 /uploads 地址";

export interface DrawInfo {
  W: number;
  H: number;
  textOn: boolean;
  labelOn: boolean;
}

function intParam(p: URLSearchParams, name: string, def: number, min?: number, max?: number): number {
  const raw = p.get(name);
  if (raw === null) return def;
  const n = parseInt(raw, 10);
  if (!isFinite(n)) return def;
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}

function colorParam(p: URLSearchParams, name: string, def: string): string {
  const raw = p.get(name);
  if (raw === null) return def;
  if (/^#[0-9a-fA-F]{6}$/.test(raw) || /^#[0-9a-fA-F]{3}$/.test(raw)) return raw;
  return def;
}

/** 内置示例底图（运行时绘制 → data URL，离线可复现）——与原版逐笔画一致 */
export function buildSampleDataURL(): string {
  const c = document.createElement("canvas");
  c.width = 1280;
  c.height = 960;
  const g = c.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, 700);
  sky.addColorStop(0, "#8fd0f5");
  sky.addColorStop(1, "#eaf7ff");
  g.fillStyle = sky;
  g.fillRect(0, 0, 1280, 700);
  // 太阳与云
  g.fillStyle = "#ffd76e";
  g.beginPath();
  g.arc(1010, 190, 86, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255,255,255,.92)";
  [
    [300, 170, 120, 34],
    [380, 140, 90, 28],
    [820, 260, 130, 36],
  ].forEach((w) => {
    g.beginPath();
    g.ellipse(w[0], w[1], w[2], w[3], 0, 0, Math.PI * 2);
    g.fill();
  });
  // 远山两叠
  g.fillStyle = "#9db8a0";
  g.beginPath();
  g.moveTo(0, 620);
  g.lineTo(260, 380);
  g.lineTo(520, 620);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(420, 650);
  g.lineTo(760, 330);
  g.lineTo(1120, 650);
  g.closePath();
  g.fill();
  g.fillStyle = "#7ea183";
  g.beginPath();
  g.moveTo(760, 660);
  g.lineTo(1080, 430);
  g.lineTo(1280, 620);
  g.lineTo(1280, 660);
  g.closePath();
  g.fill();
  // 地面
  const grass = g.createLinearGradient(0, 640, 0, 960);
  grass.addColorStop(0, "#8fbf6e");
  grass.addColorStop(1, "#5f9448");
  g.fillStyle = grass;
  g.fillRect(0, 640, 1280, 320);
  // 青旅小楼
  g.fillStyle = "#f6f1e7";
  g.fillRect(430, 470, 420, 260);
  g.fillStyle = "#c9563c";
  g.beginPath();
  g.moveTo(400, 470);
  g.lineTo(640, 340);
  g.lineTo(880, 470);
  g.closePath();
  g.fill();
  g.fillStyle = "#7a4a2b";
  g.fillRect(590, 590, 100, 140);
  g.fillStyle = "#9fd2e8";
  [
    [470, 520],
    [760, 520],
  ].forEach((w) => {
    g.fillRect(w[0], w[1], 70, 60);
  });
  g.fillStyle = "#3c4657";
  g.fillRect(430, 470, 420, 10);
  // 招牌
  g.fillStyle = "#2c3440";
  g.fillRect(500, 496, 280, 46);
  g.fillStyle = "#ffd76e";
  g.font = "600 28px " + FONT_STACK;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("青旅 YOUTH HOSTEL", 640, 520);
  // 水印
  g.fillStyle = "rgba(28,35,48,.35)";
  g.font = "600 30px " + FONT_STACK;
  g.fillText("示例底图 SAMPLE · 1280×960", 640, 900);
  return c.toDataURL("image/png");
}

/** 空态占位（与原版同文案同布局） */
export function drawPlaceholder(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d")!;
  canvas.width = 1200;
  canvas.height = 800;
  ctx.fillStyle = "#eef1f5";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#8a94a3";
  ctx.font = "600 34px " + FONT_STACK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("等待底图：上传 / 粘贴 / 载入示例图", 600, 370);
  ctx.fillText("或带 ?src= 参数打开本页（URL 参数即绘制指令）", 600, 430);
}

/**
 * 渲染主流程：底图 → URL 参数驱动画布尺寸/文字/角标。
 * 返回 null＝无底图（保持占位）；其余为状态行需要的信息。
 */
export function draw(canvas: HTMLCanvasElement, baseImg: HTMLImageElement): DrawInfo {
  const ctx = canvas.getContext("2d")!;
  const p = new URLSearchParams(window.location.search);
  const nw = baseImg.naturalWidth;
  const nh = baseImg.naturalHeight;
  let W = intParam(p, "w", 0, 16, 8192);
  let H = intParam(p, "h", 0, 16, 8192);
  if (W && H) {
    canvas.width = W;
    canvas.height = H;
    // cover：保持纵横比缩放至填满，居中裁切
    const s = Math.max(W / nw, H / nh);
    const dw = nw * s;
    const dh = nh * s;
    ctx.drawImage(baseImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } else if (W || H) {
    const scale = W ? W / nw : H / nh;
    canvas.width = W ? W : Math.round(nw * scale);
    canvas.height = H ? H : Math.round(nh * scale);
    ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
  } else {
    canvas.width = nw;
    canvas.height = nh;
    ctx.drawImage(baseImg, 0, 0);
  }
  W = canvas.width;
  H = canvas.height;

  const pad = intParam(p, "pad", 24, 0, 500);
  const size = intParam(p, "size", Math.max(20, Math.round(W * 0.06)), 8, 800);
  let pos = p.get("pos") || "bottom";
  if (["top", "center", "bottom"].indexOf(pos) < 0) pos = "bottom";
  const color = colorParam(p, "color", "#ffffff");
  const bgRaw = p.get("bg");
  const bg = bgRaw && bgRaw !== "none" && /^#[0-9a-fA-F]{6}$/.test(bgRaw) ? bgRaw : null;
  const text = p.get("text") || "";
  const lines = text.split("\n").filter((l) => l.length > 0);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (lines.length) {
    const lineHeight = Math.round(size * 1.4);
    const totalH = lineHeight * lines.length;
    const blockTop =
      pos === "top" ? pad : pos === "center" ? Math.round((H - totalH) / 2) : H - pad - totalH;
    ctx.font = "600 " + size + "px " + FONT_STACK;
    lines.forEach((line, i) => {
      const cy = blockTop + lineHeight * i + lineHeight / 2;
      const tw = ctx.measureText(line).width;
      if (bg) {
        ctx.fillStyle = bg;
        const bx = (W - tw) / 2 - pad;
        const by = cy - size * 0.72;
        const bw = tw + pad * 2;
        const bh = size * 1.44;
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(bx, by, bw, bh, Math.min(14, pad));
          ctx.fill();
        } else {
          ctx.fillRect(bx, by, bw, bh);
        }
      }
      ctx.shadowColor = bg ? "transparent" : "rgba(0,0,0,.5)";
      ctx.shadowBlur = bg ? 0 : Math.max(4, size * 0.18);
      ctx.shadowOffsetY = bg ? 0 : 2;
      ctx.fillStyle = color;
      ctx.fillText(line, W / 2, cy);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    });
  }

  // 左上角合规角标（label）
  const label = p.get("label") || "";
  if (label) {
    const lf = Math.max(13, Math.round(W * 0.03));
    ctx.font = "600 " + lf + "px " + FONT_STACK;
    const ltw = ctx.measureText(label).width;
    const lox = Math.max(12, Math.round(W * 0.022));
    const lph = Math.round(lf * 0.55);
    const lbw = ltw + lph * 2;
    const lbh = Math.round(lf * 1.7);
    ctx.fillStyle = "rgba(15,18,24,.66)";
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(lox, lox, lbw, lbh, Math.min(lbh / 2, 10));
      ctx.fill();
    } else {
      ctx.fillRect(lox, lox, lbw, lbh);
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, lox + lbw / 2, lox + lbh / 2 + 1);
  }
  return { W, H, textOn: lines.length > 0, labelOn: !!label };
}
