/*
 * base64url（UTF-8 安全，自实现，零依赖）—— apps/url-tool/src/b64.ts
 *
 * 与原单文件版逐字一致：packed = JSON.stringify → encodeURIComponent →
 * base64url；解码反向。这是对外契约（?q= 与 ?decode= 互通），算法不得改动。
 */
export function b64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): string {
  let t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4 !== 0) t += "=";
  const bin = atob(t);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * packed 参数编码：键值对 → 扁平对象（重复键保留最后一个）→ JSON →
 * encodeURIComponent → base64url。与页面 buildResult 共用此实现（WebMCP
 * pack_url 也走它——单一编码链，不许两份）。
 */
export function packedQ(pairs: [string, string][]): string {
  const obj: Record<string, string> = {};
  pairs.forEach((kv) => {
    obj[kv[0]] = kv[1];
  });
  return b64urlEncode(encodeURIComponent(JSON.stringify(obj)));
}

/** query 模式拼接：保留重复键；base 已有 query 续接；相对地址字符串兜底 */
export function joinQuery(base: string, pairs: [string, string][]): string {
  const qs = new URLSearchParams();
  pairs.forEach((kv) => qs.append(kv[0], kv[1]));
  const qstr = qs.toString();
  try {
    const u = new URL(base);
    if (qstr) {
      if (!u.search) u.search = "?" + qstr;
      else u.search = u.search + "&" + qstr;
    }
    return u.toString();
  } catch {
    if (!qstr) return base;
    return base + (base.indexOf("?") >= 0 ? (/[?&]$/.test(base) ? "" : "&") : "?") + qstr;
  }
}
