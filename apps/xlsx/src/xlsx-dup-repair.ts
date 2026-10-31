/*
 * xlsx 重名表防御（zip 级改名手术）—— apps/xlsx/src/xlsx-dup-repair.ts
 *
 * openspec: export-pdf-png（G2a）。威胁模型：SheetJS book_append_sheet 对重名
 * throw（我们生成的文件安全），但**外部构造的 xlsx 可携带重名表**（绕过 Excel
 * UI 限制）。实证（本地 0.20.3 矩阵）：SheetJS read 对重名文件 wb.SheetNames
 * 有两项但 wb.Sheets 只剩一个键——两表数据塌缩成最后一张（第一张数据在解析层
 * 就丢了），因此纯「名字级去重」救不回数据，必须在**解析前**做文件级改名。
 *
 * 手术方式（零新依赖，浏览器原生 API）：解析 zip 中央目录 → 解压
 * xl/workbook.xml（DecompressionStream deflate-raw；方法 0 直接取）→ 重名检测
 * → 重写 <sheet name="..."> 属性（去重后缀「周报 (2)」）→ **全量以 STORE
 * （不压缩）重建 zip**——仅触发于重名文件，体积增大可接受；x CRCon 写入用
 * 自实现 CRC-32。任何一步不可解（加密/罕见压缩方法/ZIP64/无中央目录）→
 * 原样返回零改动（不阻塞正常导入；此时若真有重名，桥接层 dedupeSheetNames
 * 兜底保证 seed 唯一性）。
 */

export interface DupRename {
  from: string;
  to: string;
}

export interface DupRepairResult {
  bytes: ArrayBuffer;
  /** 发生了的改名（原始名 → 去重后名）；空数组＝无重名/未手术 */
  renames: DupRename[];
}

/* ---------- CRC-32（zip 规定：多项式 0xEDB88320 反射） ---------- */

let CRC_TABLE: Uint32Array | null = null;

function crc32(u8: Uint8Array): number {
  if (!CRC_TABLE) {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    CRC_TABLE = table;
  }
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------- zip 基元 ---------- */

const SIG_LFH = 0x04034b50; // local file header
const SIG_CD = 0x02014b50; // central directory entry
const SIG_EOCD = 0x06054b50; // end of central directory

interface CdEntry {
  name: string;
  nameBytes: Uint8Array;
  utf8Flag: boolean;
  encrypted: boolean;
  method: number;
  csize: number;
  localOffset: number;
}

function findEocd(u8: Uint8Array, dv: DataView): { count: number; cdOffset: number } | null {
  // EOCD 固定 22 字节起，最多拖 65535 字节注释。字段：sig(0) disk(4) cdDisk(6)
  // entriesOnDisk(8) totalEntries(10) cdSize(12) cdOffset(16) commentLen(20)
  const start = Math.max(0, u8.length - 22 - 65535);
  for (let i = u8.length - 22; i >= start; i--) {
    if (dv.getUint32(i, true) !== SIG_EOCD) continue;
    const count = dv.getUint16(i + 10, true);
    const cdOffset = dv.getUint32(i + 16, true);
    if (cdOffset >= u8.length) return null;
    return { count, cdOffset };
  }
  return null;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 取条目原始字节（method 0 直接取；8 走 inflate；其余 null＝不可解） */
async function entryRaw(u8: Uint8Array, dv: DataView, e: CdEntry): Promise<Uint8Array | null> {
  const local = e.localOffset;
  if (local + 30 > u8.length || dv.getUint32(local, true) !== SIG_LFH) return null;
  const lfhNameLen = dv.getUint16(local + 26, true);
  const lfhExtraLen = dv.getUint16(local + 28, true);
  const dataStart = local + 30 + lfhNameLen + lfhExtraLen;
  const span = u8.subarray(dataStart, dataStart + e.csize);
  if (span.length !== e.csize) return null;
  if (e.method === 0) return span;
  if (e.method !== 8) return null;
  try {
    return await inflateRaw(span);
  } catch {
    return null;
  }
}

/* ---------- XML 名字清洗 ---------- */

function unescapeXml(s: string): string {
  return s
    .replace(/&(?:lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g, (ent) => {
      if (ent === "&lt;") return "<";
      if (ent === "&gt;") return ">";
      if (ent === "&quot;") return '"';
      if (ent === "&apos;") return "'";
      const num = ent[1] === "#" ? (ent[2] === "x" || ent[2] === "X" ? parseInt(ent.slice(3, -1), 16) : parseInt(ent.slice(2, -1), 10)) : NaN;
      return Number.isNaN(num) ? ent : String.fromCodePoint(num);
    })
    .replace(/&amp;/g, "&");
}

function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ---------- 去重命名（31 字符上限感知；桥接层兜底共用） ---------- */

function mkCandidate(base: string, k: number): string {
  const suffix = ` (${k})`;
  return base.slice(0, Math.max(1, 31 - suffix.length)) + suffix;
}

/**
 * 表名去重：重名者追加 1 起序号后缀（「周报」→「周报 (2)」）；后缀撞名继续
 * 递增。返回**新数组**（不污染入参）与改名清单。
 */
export function dedupeSheetNames(rawNames: string[]): { names: string[]; renames: DupRename[] } {
  const names = rawNames.map((n) => n.slice(0, 31));
  const used = new Set<string>();
  const renames: DupRename[] = [];
  const out = names.map((name) => {
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
    let k = 2;
    let candidate = mkCandidate(name, k);
    while (used.has(candidate)) {
      k += 1;
      candidate = mkCandidate(name, k);
    }
    used.add(candidate);
    renames.push({ from: name, to: candidate });
    return candidate;
  });
  return { names: out, renames };
}

/* ---------- 主入口 ---------- */

const noRepair = (bytes: ArrayBuffer): DupRepairResult => ({ bytes, renames: [] });

/**
 * 重名表文件级修复：检测 workbook.xml 的 <sheet name> 重复 → 重写为去重名 →
 * 重建 zip（STORE）。无重名/任何不可解形态一律原样返回（renames 空）。
 */
export async function repairDuplicateSheetNames(bytes: ArrayBuffer): Promise<DupRepairResult> {
  const u8 = new Uint8Array(bytes);
  const dv = new DataView(bytes);
  const text = new TextDecoder();
  try {
    const eocd = findEocd(u8, dv);
    if (!eocd || eocd.count === 0) return noRepair(bytes);

    const entries: CdEntry[] = [];
    let p = eocd.cdOffset;
    for (let i = 0; i < eocd.count; i++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== SIG_CD) return noRepair(bytes);
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOffset = dv.getUint32(p + 42, true);
      const nameBytes = u8.slice(p + 46, p + 46 + nameLen);
      entries.push({
        name: text.decode(nameBytes).replace(/^\//, ""),
        nameBytes,
        utf8Flag: (flags & 0x0800) !== 0,
        encrypted: (flags & 0x0001) !== 0,
        method,
        csize,
        localOffset,
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (p > u8.length) return noRepair(bytes);

    const wbEntry = entries.find((e) => e.name === "xl/workbook.xml");
    if (!wbEntry || wbEntry.encrypted) return noRepair(bytes);

    const xmlBytes = await entryRaw(u8, dv, wbEntry);
    if (!xmlBytes) return noRepair(bytes);
    const xml = text.decode(xmlBytes);

    // 按文档顺序收 <sheet> 名（\b 防 sheetData/sheetPr 误匹配）
    const tagRe = /<sheet\b[^>]*>/g;
    const tags = [...xml.matchAll(tagRe)];
    if (!tags.length) return noRepair(bytes);
    const names: string[] = [];
    for (const t of tags) {
      const m = /(?:\s|\n)name="([^"]*)"/.exec(t[0]);
      if (!m) return noRepair(bytes); // 单引号/无 name 的异常形态不手术（桥接层兜底）
      names.push(unescapeXml(m[1]));
    }
    const hasDup = new Set(names).size !== names.length;
    if (!hasDup) return noRepair(bytes);

    const { names: finalNames, renames } = dedupeSheetNames(names);

    // 依序重写 name 属性（仅动去重改变了名字的位置）
    let k = 0;
    const newXmlText = xml.replace(tagRe, (tag) => {
      const i = k++;
      if (finalNames[i] === names[i]) return tag;
      return tag.replace(/\bname="[^"]*"/, `name="${escapeXmlAttr(finalNames[i])}"`);
    });
    const newXml = new TextEncoder().encode(newXmlText);

    // 全量重建（STORE 不压缩）：每条目解出原始字节，workbook.xml 用改写后字节
    const chunks: Array<{ nameBytes: Uint8Array; data: Uint8Array; utf8Flag: boolean }> = [];
    for (const e of entries) {
      const raw = e === wbEntry ? newXml : await entryRaw(u8, dv, e);
      if (!raw) return noRepair(bytes);
      chunks.push({ nameBytes: e.nameBytes, data: raw, utf8Flag: e.utf8Flag });
    }

    const parts: Uint8Array[] = [];
    let offset = 0;
    const central: Array<{ nameBytes: Uint8Array; data: Uint8Array; utf8Flag: boolean; offset: number }> = [];
    for (const c of chunks) {
      const crc = crc32(c.data);
      const lfh = new Uint8Array(30 + c.nameBytes.length);
      const ldv = new DataView(lfh.buffer);
      ldv.setUint32(0, SIG_LFH, true);
      ldv.setUint16(4, 20, true); // version needed
      ldv.setUint16(6, c.utf8Flag ? 0x0800 : 0, true);
      ldv.setUint16(8, 0, true); // method = STORE
      ldv.setUint32(14, crc, true);
      ldv.setUint32(18, c.data.length, true);
      ldv.setUint32(22, c.data.length, true);
      ldv.setUint16(26, c.nameBytes.length, true);
      lfh.set(c.nameBytes, 30);
      parts.push(lfh, c.data);
      central.push({ ...c, offset });
      offset += lfh.length + c.data.length;
    }
    const cdStart = offset;
    for (const c of central) {
      const crc = crc32(c.data);
      const cd = new Uint8Array(46 + c.nameBytes.length);
      const cdv = new DataView(cd.buffer);
      cdv.setUint32(0, SIG_CD, true);
      cdv.setUint16(4, 20, true);
      cdv.setUint16(6, 20, true);
      cdv.setUint16(8, c.utf8Flag ? 0x0800 : 0, true);
      cdv.setUint16(10, 0, true); // method = STORE
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, c.data.length, true);
      cdv.setUint32(24, c.data.length, true);
      cdv.setUint16(28, c.nameBytes.length, true);
      cdv.setUint32(42, c.offset, true);
      cd.set(c.nameBytes, 46);
      parts.push(cd);
      offset += cd.length;
    }
    const eocdRec = new Uint8Array(22);
    const edv = new DataView(eocdRec.buffer);
    edv.setUint32(0, SIG_EOCD, true);
    edv.setUint16(8, central.length, true);
    edv.setUint16(10, central.length, true);
    edv.setUint32(12, offset - cdStart, true);
    edv.setUint32(16, cdStart, true);
    parts.push(eocdRec);
    offset += 22;

    const out = new Uint8Array(offset);
    let w = 0;
    for (const part of parts) {
      out.set(part, w);
      w += part.length;
    }
    return { bytes: out.buffer, renames };
  } catch {
    // 手术任何异常都不阻塞导入（桥接层名字级去重兜底）
    return noRepair(bytes);
  }
}
