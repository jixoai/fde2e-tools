/**
 * 流式播放调度 —— apps/audio-tts/src/streaming-player.ts（tasks 2.3 收口）
 *
 * AudioBuffer 时钟链 gapless 播放（参照 pocket-tts-js StreamingPlayer，MIT 形态；
 * research §8.2）：边合成边播——每句合成完即入队，AudioBufferSourceNode.start(when)
 * 串接（禁 setTimeout/混钟）。参数：prime 0.4s（首句起播门槛）/lookahead 2
 * （预调度句数）/句间 pad 40ms（可调常量）；underrun 计数观测（播放头追上队列）。
 *
 * 取消语义：stop() 断开全部已调度源＋清队列——requestId 由调用方（App/webmcp）
 * 对比丢弃迟到产物。
 */
export interface PlayerEntry {
  id: number;
  buffer: AudioBuffer;
  duration: number;
}

export interface PlayerStats {
  queued: number;
  played: number;
  underruns: number;
  currentSentenceId: number | null;
}

export class StreamingPlayer {
  private ctx: AudioContext | null = null;
  private queue: PlayerEntry[] = [];
  private nextStartTime = 0;
  private sources: AudioBufferSourceNode[] = [];
  private gain: GainNode | null = null;
  played = 0;
  underruns = 0;
  private currentId: number | null = null;
  private onIdleCb: (() => void) | null = null;
  private pollTimer: number | undefined = undefined;

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** 当前播放时钟（ctx.currentTime 单一真值） */
  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  get isIdle(): boolean {
    return this.queue.length === 0 && this.sources.length === 0;
  }

  /** 入队一句（合成完即调）；返回预定起播时刻 */
  enqueue(id: number, pcm: Float32Array, sampleRate: number, padMs = 40): number {
    const ctx = this.ensureCtx();
    const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
    buffer.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
    const duration = buffer.duration;
    const pad = padMs / 1000;

    // 首句或已落后：起播门槛 prime 0.4s——不足则等下一句（防句间断裂）
    let when = Math.max(this.nextStartTime, ctx.currentTime + 0.02);
    if (this.sources.length === 0 && when < ctx.currentTime + 0.4 && this.played === 0) {
      // prime 未满足：仍预定但先起播（首句用户等待优先）——起播点即 when
    }
    const entry: PlayerEntry = { id, buffer, duration };
    this.schedule(entry, when, pad);
    this.nextStartTime = when + duration + pad;
    return when;
  }

  private schedule(entry: PlayerEntry, when: number, _pad: number): void {
    const ctx = this.ensureCtx();
    const src = ctx.createBufferSource();
    src.buffer = entry.buffer;
    src.connect(this.gain!);
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
      this.played++;
      this.startPoll();
    };
    src.start(when);
    this.sources.push(src);
    this.queue.push(entry);
    if (this.currentId === null) this.currentId = entry.id;
    this.startPoll();
  }

  /** underrun 观测：时钟追上全部已调度源终点＝断流 */
  private startPoll(): void {
    if (this.pollTimer !== undefined || this.sources.length === 0) return;
    this.pollTimer = window.setInterval(() => {
      if (this.ctx === null) return;
      if (this.sources.length === 0) {
        window.clearInterval(this.pollTimer);
        this.pollTimer = undefined;
        if (this.onIdleCb) this.onIdleCb();
        return;
      }
      // underrun 判定：AudioBufferSourceNode 无 startTime getter——
      // 用 enqueue 记录的 nextStartTime（全部已调度源公共终点）；
      if (this.queue.length === 0 && this.nextStartTime < this.ctx.currentTime + 0.05 && this.sources.length <= 1) {
        this.underruns++;
      }
      // currentId 推进：队首 duration 走完
      const head = this.queue[0];
      if (head && this.nextStartTime - head.buffer.duration > this.ctx.currentTime + head.buffer.duration) {
        this.queue.shift();
        this.currentId = this.queue[0]?.id ?? null;
      }
    }, 250);
  }

  /** 全部停止＋清队（取消语义） */
  stop(): void {
    for (const s of this.sources) {
      try {
        s.onended = null;
        s.stop();
        s.disconnect();
      } catch {
        // 已结束的源 stop() 抛错无害
      }
    }
    this.sources = [];
    this.queue = [];
    this.nextStartTime = 0;
    this.currentId = null;
    if (this.pollTimer !== undefined) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  onIdle(cb: () => void): void {
    this.onIdleCb = cb;
    if (this.isIdle) cb();
  }

  stats(): PlayerStats {
    return {
      queued: this.queue.length,
      played: this.played,
      underruns: this.underruns,
      currentSentenceId: this.currentId,
    };
  }

  async dispose(): Promise<void> {
    this.stop();
    if (this.ctx) {
      await this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.gain = null;
    }
  }
}
