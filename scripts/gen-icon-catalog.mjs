#!/usr/bin/env node
/*
 * 图标目录生成器 —— scripts/gen-icon-catalog.mjs
 *
 * 从 react-icons 六族（Lucide/Tabler/Heroicons/Bootstrap/Font Awesome/Material）
 * 抽取常用图标，renderToStaticMarkup 生成
 * `apps/canvas/src/icons/catalog.generated.json`：
 *   { id, library, name, tags, viewBox, innerSvg, license }
 *
 * - 生成物入库；运行时只读 JSON，**不打包 react-icons**（devDependency）。
 * - 缺导出就跳过并打 warning（不失败整条生成）；最终必须 ≥80 条、每族 ≥10 条。
 * - 输出确定性：无时间戳，按 library 顺序 + 图标定义顺序稳定排序。
 *
 * 运行：node scripts/gen-icon-catalog.mjs（需 pnpm install）
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANVAS = join(ROOT, "apps", "canvas");
const OUT = join(CANVAS, "src", "icons", "catalog.generated.json");

const requireFromCanvas = createRequire(join(CANVAS, "package.json"));
const react = await import(requireFromCanvas.resolve("react"));
const { renderToStaticMarkup } = await import(requireFromCanvas.resolve("react-dom/server"));
const createElement = react.createElement ?? react.default?.createElement;

const LIBRARIES = [
  { id: "lucide", pack: "react-icons/lu", license: "ISC", label: "Lucide" },
  { id: "tabler", pack: "react-icons/tb", license: "MIT", label: "Tabler Icons" },
  { id: "heroicons", pack: "react-icons/hi2", license: "MIT", label: "Heroicons" },
  { id: "bootstrap", pack: "react-icons/bi", license: "MIT", label: "Bootstrap Icons" },
  { id: "fontawesome", pack: "react-icons/fa6", license: "CC BY 4.0 / OFL-1.1", label: "Font Awesome Free" },
  { id: "material", pack: "react-icons/md", license: "Apache-2.0", label: "Material Icons" },
];

/** 每个通用图标 key：tags + 各库导出名候选（按优先级，取第一个存在的导出）。
 *  与 canvas-preprocess-v2 验收清单对齐：星/心/闪电/播放/勾/关/菜单/搜索/用户/家/
 *  设置/下载/上传/分享/链接/邮件/电话/日历/时钟/定位/闪光/火箭/灯泡/图表/靶心/
 *  奖杯/盾牌/社交品牌/图片/相机/音乐/视频/文件/文件夹/锁/地球。 */
const ICONS = [
  { key: "star", tags: ["star", "favorite", "rating"], names: { lucide: ["LuStar"], tabler: ["TbStar"], heroicons: ["HiStar"], bootstrap: ["BiStar"], fontawesome: ["FaStar"], material: ["MdStar"] } },
  { key: "heart", tags: ["heart", "love", "like"], names: { lucide: ["LuHeart"], tabler: ["TbHeart"], heroicons: ["HiHeart"], bootstrap: ["BiHeart"], fontawesome: ["FaHeart"], material: ["MdFavorite"] } },
  { key: "bolt", tags: ["bolt", "zap", "energy", "fast"], names: { lucide: ["LuZap"], tabler: ["TbBolt"], heroicons: ["HiBolt"], bootstrap: ["BiSolidZap", "BiSolidBolt", "BiBolt"], fontawesome: ["FaBolt"], material: ["MdBolt"] } },
  { key: "play", tags: ["play", "media", "video"], names: { lucide: ["LuPlay"], tabler: ["TbPlayerPlay"], heroicons: ["HiPlay"], bootstrap: ["BiPlay"], fontawesome: ["FaPlay"], material: ["MdPlayArrow"] } },
  { key: "check", tags: ["check", "done", "success"], names: { lucide: ["LuCheck"], tabler: ["TbCheck"], heroicons: ["HiCheck"], bootstrap: ["BiCheck"], fontawesome: ["FaCheck"], material: ["MdCheck"] } },
  { key: "close", tags: ["close", "x", "dismiss"], names: { lucide: ["LuX"], tabler: ["TbX"], heroicons: ["HiXMark"], bootstrap: ["BiX"], fontawesome: ["FaXmark"], material: ["MdClose"] } },
  { key: "menu", tags: ["menu", "bars", "navigation"], names: { lucide: ["LuMenu"], tabler: ["TbMenu2", "TbMenu"], heroicons: ["HiBars3"], bootstrap: ["BiMenu"], fontawesome: ["FaBars"], material: ["MdMenu"] } },
  { key: "search", tags: ["search", "find", "magnifier"], names: { lucide: ["LuSearch"], tabler: ["TbSearch"], heroicons: ["HiMagnifyingGlass"], bootstrap: ["BiSearch"], fontawesome: ["FaMagnifyingGlass"], material: ["MdSearch"] } },
  { key: "user", tags: ["user", "person", "account"], names: { lucide: ["LuUser"], tabler: ["TbUser"], heroicons: ["HiUser"], bootstrap: ["BiUser"], fontawesome: ["FaUser"], material: ["MdPerson"] } },
  { key: "home", tags: ["home", "house", "start"], names: { lucide: ["LuHouse", "LuHome"], tabler: ["TbHome"], heroicons: ["HiHome"], bootstrap: ["BiHome"], fontawesome: ["FaHouse", "FaHome"], material: ["MdHome"] } },
  { key: "settings", tags: ["settings", "gear", "config"], names: { lucide: ["LuSettings"], tabler: ["TbSettings"], heroicons: ["HiCog6Tooth"], bootstrap: ["BiCog"], fontawesome: ["FaGear"], material: ["MdSettings"] } },
  { key: "download", tags: ["download", "save", "export"], names: { lucide: ["LuDownload"], tabler: ["TbDownload"], heroicons: ["HiArrowDownTray"], bootstrap: ["BiDownload"], fontawesome: ["FaDownload"], material: ["MdDownload"] } },
  { key: "upload", tags: ["upload", "import", "share"], names: { lucide: ["LuUpload"], tabler: ["TbUpload"], heroicons: ["HiArrowUpTray"], bootstrap: ["BiUpload"], fontawesome: ["FaUpload"], material: ["MdUpload"] } },
  { key: "share", tags: ["share", "send", "social"], names: { lucide: ["LuShare2"], tabler: ["TbShare"], heroicons: ["HiShare"], bootstrap: ["BiShareAlt"], fontawesome: ["FaShareNodes"], material: ["MdShare"] } },
  { key: "link", tags: ["link", "url", "chain"], names: { lucide: ["LuLink"], tabler: ["TbLink"], heroicons: ["HiLink"], bootstrap: ["BiLink"], fontawesome: ["FaLink"], material: ["MdLink"] } },
  { key: "mail", tags: ["mail", "email", "envelope"], names: { lucide: ["LuMail"], tabler: ["TbMail"], heroicons: ["HiEnvelope"], bootstrap: ["BiEnvelope"], fontawesome: ["FaEnvelope"], material: ["MdEmail"] } },
  { key: "phone", tags: ["phone", "call", "contact"], names: { lucide: ["LuPhone"], tabler: ["TbPhone"], heroicons: ["HiPhone"], bootstrap: ["BiPhone"], fontawesome: ["FaPhone"], material: ["MdPhone"] } },
  { key: "calendar", tags: ["calendar", "date", "schedule"], names: { lucide: ["LuCalendar"], tabler: ["TbCalendar"], heroicons: ["HiCalendar"], bootstrap: ["BiCalendar"], fontawesome: ["FaCalendar"], material: ["MdCalendarMonth"] } },
  { key: "clock", tags: ["clock", "time", "schedule"], names: { lucide: ["LuClock"], tabler: ["TbClock"], heroicons: ["HiClock"], bootstrap: ["BiTime"], fontawesome: ["FaClock"], material: ["MdAccessTime"] } },
  { key: "map-pin", tags: ["map-pin", "place", "location", "pin"], names: { lucide: ["LuMapPin"], tabler: ["TbMapPin"], heroicons: ["HiMapPin"], bootstrap: ["BiMapPin"], fontawesome: ["FaLocationDot"], material: ["MdPlace"] } },
  { key: "sparkles", tags: ["sparkles", "magic", "ai", "shine"], names: { lucide: ["LuSparkles"], tabler: ["TbSparkles"], heroicons: ["HiSparkles"], bootstrap: ["BiSolidStar", "BiStar"], fontawesome: ["FaWandMagicSparkles"], material: ["MdAutoAwesome"] } },
  { key: "rocket", tags: ["rocket", "launch", "startup"], names: { lucide: ["LuRocket"], tabler: ["TbRocket"], heroicons: ["HiRocketLaunch"], bootstrap: ["BiRocket"], fontawesome: ["FaRocket"], material: ["MdRocketLaunch"] } },
  { key: "bulb", tags: ["bulb", "idea", "light"], names: { lucide: ["LuLightbulb"], tabler: ["TbBulb"], heroicons: ["HiLightBulb"], bootstrap: ["BiBulb"], fontawesome: ["FaLightbulb"], material: ["MdLightbulb"] } },
  { key: "chart", tags: ["chart", "analytics", "data"], names: { lucide: ["LuChartColumn", "LuBarChart"], tabler: ["TbChartBar"], heroicons: ["HiChartBar"], bootstrap: ["BiBarChart"], fontawesome: ["FaChartColumn"], material: ["MdBarChart"] } },
  { key: "target", tags: ["target", "goal", "focus"], names: { lucide: ["LuTarget"], tabler: ["TbTarget"], bootstrap: ["BiTargetLock"], fontawesome: ["FaBullseye"], material: ["MdTrackChanges", "MdAdjust"] } },
  { key: "trophy", tags: ["trophy", "award", "winner"], names: { lucide: ["LuTrophy"], tabler: ["TbTrophy"], heroicons: ["HiTrophy"], bootstrap: ["BiTrophy"], fontawesome: ["FaTrophy"], material: ["MdEmojiEvents"] } },
  { key: "shield-check", tags: ["shield", "security", "verified"], names: { lucide: ["LuShieldCheck"], tabler: ["TbShieldCheck"], heroicons: ["HiShieldCheck"], bootstrap: ["BiCheckShield"], fontawesome: ["FaShieldHalved"], material: ["MdShield"] } },
  { key: "github", tags: ["github", "code", "brand"], names: { lucide: ["LuGithub"], tabler: ["TbBrandGithub"], bootstrap: ["BiLogoGithub", "BiGithub"], fontawesome: ["FaGithub"] } },
  { key: "x-twitter", tags: ["x", "twitter", "brand", "social"], names: { lucide: ["LuTwitter"], tabler: ["TbBrandX", "TbBrandTwitter"], bootstrap: ["BiLogoTwitter"], fontawesome: ["FaXTwitter", "FaTwitter"] } },
  { key: "wechat", tags: ["wechat", "weixin", "brand", "social"], names: { tabler: ["TbBrandWechat"], fontawesome: ["FaWeixin"] } },
  { key: "tiktok", tags: ["tiktok", "brand", "social"], names: { tabler: ["TbBrandTiktok"], fontawesome: ["FaTiktok"] } },
  { key: "instagram", tags: ["instagram", "brand", "social"], names: { tabler: ["TbBrandInstagram"], fontawesome: ["FaInstagram"] } },
  { key: "youtube", tags: ["youtube", "brand", "video"], names: { tabler: ["TbBrandYoutube"], fontawesome: ["FaYoutube"] } },
  { key: "image", tags: ["image", "photo", "picture"], names: { lucide: ["LuImage"], tabler: ["TbPhoto"], heroicons: ["HiPhoto"], bootstrap: ["BiImage"], fontawesome: ["FaImage"], material: ["MdImage"] } },
  { key: "camera", tags: ["camera", "photo", "capture"], names: { lucide: ["LuCamera"], tabler: ["TbCamera"], heroicons: ["HiCamera"], bootstrap: ["BiCamera"], fontawesome: ["FaCamera"], material: ["MdPhotoCamera"] } },
  { key: "music", tags: ["music", "audio", "sound"], names: { lucide: ["LuMusic"], tabler: ["TbMusic"], heroicons: ["HiMusicalNote"], bootstrap: ["BiMusic"], fontawesome: ["FaMusic"], material: ["MdMusicNote"] } },
  { key: "video", tags: ["video", "movie", "media"], names: { lucide: ["LuVideo"], tabler: ["TbVideo"], heroicons: ["HiVideoCamera"], bootstrap: ["BiVideo"], fontawesome: ["FaVideo"], material: ["MdVideocam"] } },
  { key: "file", tags: ["file", "document", "page"], names: { lucide: ["LuFile"], tabler: ["TbFile"], heroicons: ["HiDocument"], bootstrap: ["BiFile"], fontawesome: ["FaFile"], material: ["MdInsertDriveFile"] } },
  { key: "folder", tags: ["folder", "directory", "files"], names: { lucide: ["LuFolder"], tabler: ["TbFolder"], heroicons: ["HiFolder"], bootstrap: ["BiFolder"], fontawesome: ["FaFolder"], material: ["MdFolder"] } },
  { key: "lock", tags: ["lock", "security", "private"], names: { lucide: ["LuLock"], tabler: ["TbLock"], heroicons: ["HiLockClosed"], bootstrap: ["BiLock"], fontawesome: ["FaLock"], material: ["MdLock"] } },
  { key: "globe", tags: ["globe", "world", "web"], names: { lucide: ["LuGlobe"], tabler: ["TbWorld"], heroicons: ["HiGlobeAlt"], bootstrap: ["BiGlobe"], fontawesome: ["FaGlobe"], material: ["MdPublic"] } },
];

/** 只保留会影响渲染的根属性（宽高/viewBox 由运行时按请求尺寸重建）。 */
const KEEP_ATTRS = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "fill-rule",
  "clip-rule",
  "opacity",
  "style",
];

function extractSvg(markup) {
  const m = /^<svg([^>]*)>([\s\S]*)<\/svg>$/i.exec(markup.trim());
  if (!m) throw new Error(`无法解析 react-icons 输出：${markup.slice(0, 120)}`);
  const [, attrs, inner] = m;
  const viewBox = /viewBox="([^"]+)"/.exec(attrs)?.[1];
  if (!viewBox) throw new Error("react-icons 输出缺 viewBox");
  const kept = [];
  for (const name of KEEP_ATTRS) {
    const re = new RegExp(`\\s${name}="([^"]*)"`);
    const hit = re.exec(attrs);
    if (hit) kept.push(`${name}="${hit[1]}"`);
  }
  const innerSvg = kept.length > 0 ? `<g ${kept.join(" ")}>${inner}</g>` : inner;
  return { viewBox, innerSvg };
}

const entries = [];
const missing = [];
const packs = {};
for (const lib of LIBRARIES) {
  const mod = await import(requireFromCanvas.resolve(lib.pack));
  packs[lib.id] = mod;
}

for (const icon of ICONS) {
  for (const lib of LIBRARIES) {
    const candidates = icon.names[lib.id] ?? [];
    if (candidates.length === 0) continue;
    const componentName = candidates.find((n) => n in packs[lib.id]);
    if (!componentName) {
      missing.push(`${lib.id}/${icon.key}（候选 ${candidates.join("/")}）`);
      continue;
    }
    const markup = renderToStaticMarkup(createElement(packs[lib.id][componentName]));
    const { viewBox, innerSvg } = extractSvg(markup);
    entries.push({
      id: `${lib.id}:${icon.key}`,
      library: lib.id,
      name: icon.key,
      tags: [icon.key, ...icon.tags.filter((t) => t !== icon.key), lib.id],
      viewBox,
      innerSvg,
      license: lib.license,
    });
  }
}

const byLibrary = Object.fromEntries(LIBRARIES.map((l) => [l.id, 0]));
for (const entry of entries) byLibrary[entry.library] += 1;

console.log(`生成图标 ${entries.length} 个：`);
for (const lib of LIBRARIES) console.log(`  ${lib.label.padEnd(20)} ${String(byLibrary[lib.id]).padStart(3)}`);
if (missing.length > 0) {
  console.warn(`跳过缺失导出 ${missing.length} 项：`);
  for (const item of missing) console.warn("  -", item);
}

if (entries.length < 80) {
  console.error(`✗ 图标数 ${entries.length} < 80（react-icons 版本/导出名变化？）`);
  process.exit(1);
}
for (const lib of LIBRARIES) {
  if (byLibrary[lib.id] < 10) {
    console.error(`✗ ${lib.id} 只有 ${byLibrary[lib.id]} 个图标（要求 ≥10）`);
    process.exit(1);
  }
}
const bad = entries.find((e) => /<script|\son[a-z]+=/i.test(e.innerSvg));
if (bad) {
  console.error(`✗ ${bad.id} 的 innerSvg 含脚本/事件属性`);
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(entries, null, 2) + "\n");
console.log(`✓ 写入 ${OUT}`);
