/*
 * slides 输入解析单源 —— apps/pptx/src/spec.ts
 *
 * 输入契约：{"slides":[{"title":"页标题","bullets":["要点",...],"notes":"备注"}]}
 * 同一份解析驱动预览与 pptx 生成（禁止各写一套）。全部错误人话化。
 */

export interface SlideSpec {
  title: string;
  bullets: string[];
  notes?: string;
}

export interface DeckSpec {
  slides: SlideSpec[];
}

/** 校验并归一 deck 结构（JSON/程序化构造共用） */
export function normalizeDeck(data: unknown): DeckSpec {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error('slides 结构错误：顶层应为对象 {"slides":[{"title":"页标题","bullets":["要点"],"notes":"备注"}]}');
  }
  const slidesRaw = (data as { slides?: unknown }).slides;
  if (!Array.isArray(slidesRaw) || slidesRaw.length === 0) {
    throw new Error("slides 结构错误：slides 必须是非空数组");
  }
  const slides: SlideSpec[] = slidesRaw.map((s, i) => {
    if (s === null || typeof s !== "object" || Array.isArray(s)) {
      throw new Error(`slides[${i}] 结构错误：应为 {"title","bullets","notes"}`);
    }
    const titleRaw = (s as { title?: unknown }).title;
    const title = typeof titleRaw === "string" ? titleRaw.trim() : "";
    if (!title) throw new Error(`slides[${i}] 缺少 title（每页必须有标题）`);
    const bulletsRaw = (s as { bullets?: unknown }).bullets;
    let bullets: string[] = [];
    if (bulletsRaw !== undefined && bulletsRaw !== null) {
      if (!Array.isArray(bulletsRaw)) {
        throw new Error(`slides[${i}]（${title}）的 bullets 必须是字符串数组`);
      }
      bullets = bulletsRaw.map((b) => String(b));
    }
    const notesRaw = (s as { notes?: unknown }).notes;
    const notes =
      typeof notesRaw === "string" && notesRaw.trim() ? notesRaw.trim() : undefined;
    return { title, bullets, notes };
  });
  return { slides };
}

/** JSON 输入 → deck（空输入/语法错误/结构错误都给人话） */
export function parseDeckJson(text: string): DeckSpec {
  if (!text.trim()) {
    throw new Error("输入为空：请先粘贴 slides JSON、或点「载入示例」。");
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("JSON 解析失败：" + (e instanceof Error ? e.message : String(e)));
  }
  return normalizeDeck(data);
}

export function deckStats(spec: DeckSpec): { slideCount: number; bulletCount: number } {
  return {
    slideCount: spec.slides.length,
    bulletCount: spec.slides.reduce((n, s) => n + s.bullets.length, 0),
  };
}
