/**
 * FDE2E smart-dl-core —— 多源 Range 并行下载核心（fde2e-downloader-core bundle）
 *
 * 由 scripts/build-downloader-core.mjs 从主仓 packages/downloader-core 构建生成，
 * 禁止手改；漂移由 --check 门把守（重建 diff 必须为零）。
 * 对外 API 冻结：globalThis.FDE2ESmartDLCore（audio-stt/tts 两站模型下载消费）。
 */
var FDE2ESmartDLCoreBundle = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	// ../../packages/downloader-core/src/scheduler.ts
	/**
	* 调度器——Source 池 / 加权随机 / EMA 权重 / 失败惩罚 / 熔断冷却
	*
	* 语义逐条对齐 site/public/downloads/assets/smart-dl-core.js（643 断言行为基线）：
	*  - 权重＝EMA 吞吐（MB/s），成功一次即按新吞吐重建；速度即权重；
	*  - EMA α=0.3；失败一次权重 ×0.35（立即衰减），floor＝MIN_WEIGHT；
	*  - 连败 ≥4 权重压到 floor（近乎熔断，成功后按吞吐自动恢复）；
	*  - 连败 ≥8 硬熔断：20s 冷却期（低吞吐区间 weight floor 会让死源仍吃走
	*    ~30% 分派——冷却止血）；
	*  - 加权随机分派：单源 inflight 达 cap 3 或冷却中即不可用；全不可用返回 null。
	*/
	const EMA_ALPHA = .3;
	const FAIL_PENALTY = .35;
	const MIN_WEIGHT = .02;
	const COOLDOWN_MS = 2e4;
	var Source = class {
		id;
		make;
		weight = 1;
		emaBps = 0;
		inflight = 0;
		failStreak = 0;
		cooldownUntil = 0;
		bytes = 0;
		ms = 0;
		ok = 0;
		fail = 0;
		/** 冷却判定时钟（基线 Date.now；engine 注入自身时钟保证 set/compare 同源） */
		clock;
		constructor(id, make, clock = Date.now) {
			this.id = id;
			this.make = make;
			this.clock = clock;
		}
		report(bytes, ms) {
			const bps = ms > 0 ? bytes / ms * 1e3 : 0;
			this.emaBps = this.emaBps === 0 ? bps : this.emaBps * .7 + bps * EMA_ALPHA;
			this.weight = Math.max(this.emaBps / 1048576, MIN_WEIGHT);
			this.failStreak = 0;
			this.cooldownUntil = 0;
			this.ok++;
			this.bytes += bytes;
			this.ms += ms;
		}
		reportFail() {
			this.fail++;
			this.failStreak++;
			this.weight = Math.max(this.weight * FAIL_PENALTY, MIN_WEIGHT);
			if (this.failStreak >= 4) this.weight = MIN_WEIGHT;
			if (this.failStreak >= 8) this.cooldownUntil = this.clock() + COOLDOWN_MS;
		}
	};
	/**
	* 模板源克隆（基线 Download 构造：以共享模板逐字段重置复制——
	* id/make 保留，运行期统计字段全部归零）。独立函数而非原型方法：
	* Source.prototype 冻结为与线上完全同面（report/reportFail）。
	*/
	function cloneSource(s) {
		const c = new Source(s.id, s.make, s.clock);
		c.weight = 1;
		c.emaBps = 0;
		c.inflight = 0;
		c.failStreak = 0;
		c.cooldownUntil = 0;
		c.bytes = 0;
		c.ms = 0;
		c.ok = 0;
		c.fail = 0;
		return c;
	}
	/** 加权随机挑一个可用源；无可用（全部满 cap 或冷却中）返回 null */
	function pickWeighted(sources, deps = {}) {
		const now = (deps.now ?? Date.now)();
		const random = deps.random ?? Math.random;
		const usable = sources.filter((s) => s.inflight < 3 && now >= s.cooldownUntil);
		if (usable.length === 0) return null;
		const total = usable.reduce((a, s) => a + s.weight, 0);
		let r = random() * total;
		for (const s of usable) {
			r -= s.weight;
			if (r <= 0) return s;
		}
		return usable[usable.length - 1];
	}
	// ../../packages/downloader-core/src/sources.ts
	/**
	* 源清单（CORS 实测定案；源抽象可扩展 P2P/新镜像）
	*
	* !!! 反代 query 原样拼接，禁 encodeURIComponent !!!
	* u 必须原样进 query——OpenResty $arg_u 不做百分号解码，编码形态会被
	* /dl-gh/ lua 的 ^https:// 校验 400 拒绝（2026-10-23 生产实证）。
	*/
	const SOURCES = [new Source("cf-edge", (u) => "https://gh.fde2e.tweb.xin/" + u), new Source("aliyun", (u) => "https://www.fde2e.com/dl-gh/?u=" + u)];
	// ../../packages/downloader-core/src/filestore.ts
	/**
	* 成品仓纯函数（v0.1.3 downloader-cache-retention）
	*
	*  - deriveAppId：文件名→应用标识（剥末尾版本段）；「每应用仅最新版」保留策略的
	*    分组键。显式 appId 入参优先，此推导只做缺省兜底。
	*  - fileKeyOf：成品键 `file:<appId>:<identity>`（identity＝sha256 或 `s<size>`）。
	*
	* 推导示例（真实产物名）：
	*   fde2e-bu-bridge-v1.5.1.zip       → fde2e-bu-bridge
	*   FDE2E-Center-Setup-0.1.3.exe     → FDE2E-Center-Setup
	*   FDE2E Omni-Setup-0.2.0.exe       → FDE2E Omni-Setup
	*   readme.txt（无版本段）            → readme（全名退化——同文件名幂等覆盖）
	*/
	/** 版本段：分隔符（- _ 空格）＋可选 v/V 前缀＋至少两节数字（防误伤 `-2.zip` 类名） */
	const VERSION_SEG = /[-_ ]v?\d+\.\d+/i;
	function deriveAppId(name) {
		const m = name.match(VERSION_SEG);
		return (m && m.index != null ? name.slice(0, m.index) : name.replace(/\.[^.]+$/, "")).replace(/[-_ ]+$/, "") || name;
	}
	function fileKeyOf(appId, identity) {
		return `file:${appId}:${identity}`;
	}
	/** 同 app 成品键前缀（驱逐/删除的匹配域） */
	function fileKeyPrefixOf(appId) {
		return `file:${appId}:`;
	}
	// ../../packages/downloader-core/src/engine.ts
	/**
	* 下载引擎——分块 / 续传 / 组装 / sha256 门（fde2e-downloader-core）
	*
	* 语义基线＝smart-dl-core.js（643 断言行为基线）：
	*  - 4 MiB 分块 × 全局并发 6 × 每源 cap 3；
	*  - 断点续传：run() 首扫块仓，已有块计入 doneBytes 并标 done；
	*  - 块级重试上限 6 次＋300ms 退避；无源可用等待 120ms 重派；
	*  - 单请求 60s / probe 15s 超时（AbortSignal.any + timeout 注入化）；
	*  - pause()/paused：abort 在飞请求，run() 以 'paused' resolve；重跑即断点续传；
	*  - progress 分片级 payload（chunks[]）与 web 管理器现形态同构。
	*
	* 本包新增（Center 集成需要，web 路径不传期望时零行为变化）：
	*  - sha256 门三态：match / mismatch / no-expected（缺期望如实标注）；
	*  - assembleBytes()：按序组装为内存字节（Node/Center 落盘用）。
	*
	* v0.1.2（downloader-straggler-takeover，Owner 2026-10-24）：
	*  - 流式接收＋断点缓冲：fetchChunk 改 ReadableStream 增量接收，实时记录已收
	*    （liveLen）；中止（超时/迁移）时 partial 保留在 per-chunk ctx，续传以
	*    Range bytes=start+len−end 重派，完成后 partial＋续传段拼接为完整块落仓
	*    （「分块内混合下载」——ChunkStore 接口不变，块仍整块落仓）。
	*  - 长尾迁移（tail takeover）：队列已空 ∧ 存在空闲快源（inflight<cap）∧ 慢块
	*    在当前源预估剩余 > 快源预估 ×1.5 且当前尝试已跑 ≥5s —— abort 慢源请求
	*    （partial 保留），剩余段重派快源。迁移次数上限/块＝2（防抖动）；迁移是
	*    调度行为不是错误——不占失败重试计数、不计源 fail。
	*  - 语义冻结面不动：块大小/全局并发/每源 cap/EMA/失败惩罚照旧；progress
	*    payload 形态与口径不变（迁移交接仅体现为 chunks[].srcId 变化＋一帧常规广播）。
	*
	* 平台差异（fetch/存储/时钟/中止信号/随机数）全部经 DownloadIo 注入。
	*/
	const CHUNK = 4194304;
	const REQUEST_TIMEOUT_MS = 6e4;
	const PROBE_TIMEOUT_MS = 15e3;
	function fmtBytes(n) {
		if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
		if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
		return n + " B";
	}
	function toHex(b) {
		let s = "";
		for (const x of b) s += x.toString(16).padStart(2, "0");
		return s;
	}
	var Download = class {
		ghUrl;
		name;
		size;
		/** 成品仓分组键（opts.appId 优先；缺省 deriveAppId(name)——每应用仅最新版驱逐域） */
		appId;
		onProgress;
		cancelled = false;
		paused = false;
		userGesture;
		expectedSha256;
		sources;
		doneBytes = 0;
		total = 0;
		chunkStates = null;
		noRange = false;
		abortController = null;
		abortSignal = null;
		active = /* @__PURE__ */ new Map();
		queue = [];
		io;
		constructor(opts, io) {
			this.ghUrl = opts.ghUrl;
			this.name = opts.name || (opts.ghUrl.split("/").pop() ?? "");
			this.size = opts.size || 0;
			this.appId = opts.appId || deriveAppId(this.name);
			this.onProgress = opts.onProgress || (() => {});
			this.userGesture = !!opts.userGesture;
			this.expectedSha256 = opts.expectedSha256 ?? null;
			this.sources = (opts.sources ?? SOURCES).map((s) => cloneSource(s));
			this.io = io;
			for (const s of this.sources) s.clock = () => this.io.timer.epoch();
		}
		async probeSize() {
			const s = this.sources[0];
			const r = await this.io.fetch(s.make(this.ghUrl), {
				headers: { range: "bytes=0-0" },
				signal: this.io.abort.any([this.abortSignal, this.io.abort.timeout(PROBE_TIMEOUT_MS)])
			});
			const cr = r.headers.get("content-range");
			if (cr) {
				const m = cr.match(/\/(\d+)$/);
				if (m) return +m[1];
			}
			const cl = r.headers.get("content-length");
			if (r.ok && cl && !cr) {
				this.noRange = true;
				return +cl;
			}
			throw new Error("无法探测文件大小（源不可用或不支持 Range）");
		}
		chunkCount() {
			return this.noRange ? 1 : Math.ceil(this.size / CHUNK);
		}
		chunkLen(i) {
			return this.noRange ? this.size : Math.min(CHUNK, this.size - i * CHUNK);
		}
		chunkKey(i) {
			return `${this.name}:${this.size}:${i}`;
		}
		/** 块状态标记（分片网格数据源） */
		markChunk(i, state, srcId, bps) {
			if (!this.chunkStates || !this.chunkStates[i]) return;
			const c = this.chunkStates[i];
			c.state = state;
			if (srcId !== void 0) c.srcId = srcId;
			if (bps !== void 0) c.bps = bps;
		}
		ensureCtx(i) {
			let c = this.active.get(i);
			if (!c) {
				c = {
					idx: i,
					parts: [],
					len: 0,
					liveLen: 0,
					attemptFromLen: 0,
					attemptStart: 0,
					owner: null,
					migrations: 0,
					attemptGen: 0,
					attemptParts: [],
					takeCtrl: null,
					attemptsInflight: 0,
					done: false
				};
				this.active.set(i, c);
			}
			return c;
		}
		/**
		* 取一个块段（v0.1.2 流式版）。
		* - ctx/fromLen：迁移接管显式传收割点；普通派发/失败重试缺省＝ctx.len（partial 续传）。
		* - 流式接收：response.body.getReader() 增量读，实时入 ctx.attemptParts＋liveLen
		*   （迁移 ETA 估计与 claim 同步收割的数据源）；无 body 的注入实现回落 arrayBuffer 整读。
		* - 中止（超时/迁移）：未让渡（代数仍当前）时 partial 并入 parts 交由重试续传；
		*   已让渡（被 claim）则 attemptParts 已被收割方取走，本 attempt 静默退出。
		* - 完成协议：代数当前且凑满 ⇒ 同步置 done＋一次性落仓（恰好一次）。
		*/
		async fetchChunk(src, i, ctx, fromLen) {
			const start0 = i * CHUNK;
			const end = this.noRange ? "" : Math.min(start0 + CHUNK - 1, this.size - 1);
			const c = ctx ?? this.ensureCtx(i);
			const from = fromLen ?? (this.noRange ? 0 : c.len);
			const url = src.make(this.ghUrl);
			const headers = this.noRange ? {} : { range: `bytes=${start0 + from}-${end}` };
			if (from === 0) {
				c.parts = [];
				c.len = 0;
			}
			const gen = ++c.attemptGen;
			c.attemptFromLen = from;
			c.attemptStart = this.io.timer.now();
			c.owner = src.id;
			c.liveLen = from;
			c.attemptParts = [];
			c.takeCtrl = new AbortController();
			const tc = c.takeCtrl;
			c.attemptsInflight++;
			const t0 = c.attemptStart;
			const chunkLen = this.chunkLen(i);
			const expect = Math.max(0, chunkLen - from);
			const local = c.attemptParts;
			let localLen = 0;
			try {
				const r = await this.io.fetch(url, {
					headers,
					signal: this.io.abort.any([
						this.abortSignal,
						this.io.abort.timeout(REQUEST_TIMEOUT_MS),
						tc.signal
					])
				});
				if (!r.ok && r.status !== 206) throw new Error("HTTP " + r.status);
				const body = r.body;
				if (body && typeof body.getReader === "function") {
					const reader = body.getReader();
					try {
						for (;;) {
							const { done, value } = await reader.read();
							if (done || c.attemptGen !== gen || c.done) break;
							if (value && value.length) {
								const take = Math.min(value.length, expect - localLen);
								if (take > 0) {
									local.push(take === value.length ? value : value.subarray(0, take));
									localLen += take;
								}
								c.liveLen = c.attemptFromLen + localLen;
								if (localLen >= expect) {
									quietCancel(reader);
									break;
								}
							}
						}
					} catch (e) {
						if (c.attemptGen === gen && !this.noRange && !c.done) {
							for (const p of local) c.parts.push(p);
							c.len += localLen;
						} else if (localLen > 0) src.report(localLen, Math.max(this.io.timer.now() - t0, 1));
						throw e;
					}
					quietCancel(reader);
				} else {
					const buf = await r.arrayBuffer();
					if (c.attemptGen === gen && !c.done) {
						const u = new Uint8Array(buf);
						const take = Math.min(u.length, expect);
						local.push(take === u.length ? u : u.subarray(0, take));
						localLen = take;
						c.liveLen = c.attemptFromLen + localLen;
					}
				}
			} finally {
				c.attemptsInflight--;
			}
			await this.commitAttempt(c, gen, localLen, chunkLen, src);
			if (localLen > 0 && (c.attemptGen === gen || c.done)) src.report(localLen, Math.max(this.io.timer.now() - t0, 1));
			return localLen;
		}
		/** 完成协议：代数当前且凑满 ⇒ 同步置 done＋一次落仓；短响应（未让渡）按失败抛出交由重试续传 */
		async commitAttempt(c, gen, localLen, chunkLen, src) {
			if (c.attemptGen !== gen || c.done) return;
			for (const p of c.attemptParts) c.parts.push(p);
			c.len += localLen;
			if (c.len < chunkLen) throw new Error(`短响应：块 ${c.idx} 收 ${c.len}/${chunkLen} 字节`);
			c.done = true;
			const all = new Uint8Array(c.len);
			let off = 0;
			for (const p of c.parts) {
				all.set(p, off);
				off += p.length;
			}
			const ms = Math.max(this.io.timer.now() - c.attemptStart, 1);
			await this.io.store.put(this.chunkKey(c.idx), all);
			this.doneBytes += chunkLen;
			this.markChunk(c.idx, "done", src.id, Math.round(localLen / ms * 1e3));
		}
		/**
		* 长尾迁移决策（同步原子段：JS 单线程内 claim＋收割不会被交错）。
		* 触发条件（proposal 铁律）：队列已空 ∧ 存在空闲快源（inflight<cap 且不在冷却）∧
		* victim 在当前源预估剩余 > 快源预估 ×TAKEOVER_ADVANTAGE 且当前尝试已跑 ≥TAKEOVER_MIN_RUN_MS。
		* 命中（claim）：同步收割 victim 已收段（attemptParts→parts，零字节浪费）＋换代（victim
		* 后续写入失配自弃）＋abort 其请求＋owner 让渡＋migration++（不占失败重试计数）。
		* 返回 {idx, ctx, src, from} 给空闲 worker 立即接管剩余段；null＝无可迁。
		*/
		attemptTakeover() {
			if (this.noRange || this.cancelled || this.paused) return null;
			if (this.queue.length > 0) return null;
			const now = this.io.timer.now();
			let best = null;
			for (const c of this.active.values()) {
				if (c.done || c.attemptsInflight <= 0) continue;
				if (now - c.attemptStart < 5e3) continue;
				if (c.migrations >= 2) continue;
				if (this.chunkLen(c.idx) - c.liveLen <= 0) continue;
				const elapsed = Math.max(1, now - c.attemptStart);
				const attemptRecv = c.liveLen - c.attemptFromLen;
				if (attemptRecv <= 0) continue;
				const slowBps = attemptRecv / elapsed * 1e3;
				const fast = this.sources.filter((s) => s.id !== c.owner && s.inflight < 3 && now >= s.cooldownUntil && s.emaBps > 0).sort((a, b) => b.emaBps - a.emaBps)[0];
				if (!fast) continue;
				if (fast.emaBps > slowBps * 1.5) {
					if (!best || slowBps < best.slowBps) best = {
						ctx: c,
						slowBps,
						fast
					};
				}
			}
			if (!best) return null;
			const { ctx, fast } = best;
			const from = ctx.liveLen;
			for (const p of ctx.attemptParts) ctx.parts.push(p);
			ctx.len += from - ctx.attemptFromLen;
			ctx.attemptGen++;
			ctx.attemptParts = [];
			ctx.migrations++;
			ctx.owner = fast.id;
			try {
				ctx.takeCtrl?.abort(/* @__PURE__ */ new Error("tail-takeover"));
			} catch {}
			this.markChunk(ctx.idx, "active", fast.id);
			this.emit();
			return {
				idx: ctx.idx,
				ctx,
				src: fast,
				from
			};
		}
		/** 队列空时 idle worker 是否值得继续等接管（存在可迁移的在飞块） */
		takeoverHopeful() {
			if (this.noRange) return false;
			for (const c of this.active.values()) if (!c.done && c.migrations < 2 && c.attemptsInflight > 0) return true;
			return false;
		}
		async run() {
			await this.io.store.open?.();
			this.abortController = new AbortController();
			this.abortSignal = this.abortController.signal;
			this.doneBytes = 0;
			this.active = /* @__PURE__ */ new Map();
			if (!this.size) this.size = await this.probeSize();
			this.total = this.size;
			const n = this.chunkCount();
			this.chunkStates = Array.from({ length: n }, (_, i) => ({
				idx: i,
				state: "queued",
				srcId: null,
				bps: 0
			}));
			const done = /* @__PURE__ */ new Set();
			for (let i = 0; i < n; i++) {
				const existed = await this.io.store.get(this.chunkKey(i));
				if (existed) {
					done.add(i);
					this.doneBytes += existed.size;
					this.markChunk(i, "done");
				}
			}
			const pending = [];
			for (let i = 0; i < n; i++) pending.push(i);
			this.emit();
			this.queue = pending.filter((i) => true);
			const attempts = {};
			const self = this;
			async function worker() {
				while (!self.cancelled && !self.paused) {
					let next = self.queue.shift();
					let ctx;
					let src = null;
					let from;
					if (next === void 0) {
						const tk = self.attemptTakeover();
						if (tk) {
							next = tk.idx;
							ctx = tk.ctx;
							src = tk.src;
							from = tk.from;
						} else if (self.takeoverHopeful()) {
							await self.io.timer.sleep(500);
							continue;
						} else return;
					}
					if (done.has(next)) continue;
					if (!ctx || !src) {
						ctx = self.ensureCtx(next);
						src = pickWeighted(self.sources, {
							now: () => self.io.timer.epoch(),
							random: self.io.random
						});
					}
					if (!src) {
						await self.io.timer.sleep(120);
						self.queue.unshift(next);
						continue;
					}
					if (ctx.done) continue;
					src.inflight++;
					self.markChunk(next, "active", src.id);
					try {
						await self.fetchChunk(src, next, ctx, from);
						done.add(next);
						self.active.delete(next);
						self.emit();
					} catch (e) {
						if (self.cancelled || self.paused) return;
						if (ctx.owner !== src.id) continue;
						src.reportFail();
						attempts[next] = (attempts[next] || 0) + 1;
						if (attempts[next] >= 6) {
							self.markChunk(next, "failed");
							self.active.delete(next);
							self.emit();
							continue;
						}
						await self.io.timer.sleep(300);
						self.queue.push(next);
						self.emit();
					} finally {
						src.inflight--;
					}
				}
			}
			await Promise.all(Array.from({ length: 6 }, worker));
			if (this.paused) return "paused";
			if (this.cancelled) throw new Error("已取消");
			if (done.size < n) throw new Error("存在未完成分块");
			return "done";
		}
		emit() {
			const effectiveBps = (s) => s.emaBps * Math.min(s.inflight || 1, 3);
			const totalBps = this.sources.reduce((a, s) => a + effectiveBps(s), 0);
			this.onProgress({
				done: this.doneBytes,
				total: this.total,
				pct: this.total ? Math.floor(this.doneBytes / this.total * 100) : 0,
				bps: totalBps,
				sources: this.sources.map((s) => ({
					id: s.id,
					bps: effectiveBps(s),
					weight: s.weight,
					ok: s.ok,
					fail: s.fail
				})),
				chunks: this.chunkStates ? this.chunkStates.map((c) => ({
					idx: c.idx,
					state: c.state,
					srcId: c.srcId,
					bps: c.bps
				})) : []
			});
		}
		cancel() {
			this.cancelled = true;
			this.abortController?.abort();
		}
		pause() {
			this.paused = true;
			this.abortController?.abort();
		}
		/** 连接卫生：生命周期结束必须收连接（挂开的连接会卡死 deleteDatabase——E2E 实证） */
		closeDb() {
			try {
				this.io.store.close?.();
			} catch {}
		}
		/** 按序读出全部块并拼接（Node/Center 落盘用；web 路径走子类 assemble 的流式保存） */
		async assembleBytes() {
			const n = this.chunkCount();
			const parts = [];
			let len = 0;
			for (let i = 0; i < n; i++) {
				const c = await this.io.store.get(this.chunkKey(i));
				if (!c) throw new Error(`块缺失：${this.chunkKey(i)}`);
				const u = c.data instanceof Uint8Array ? c.data : new Uint8Array(await c.data.arrayBuffer());
				parts.push(u);
				len += u.length;
			}
			const out = new Uint8Array(len);
			let off = 0;
			for (const p of parts) {
				out.set(p, off);
				off += p.length;
			}
			return out;
		}
		/**
		* 组装成品入仓（v0.1.3 downloader-cache-retention，Owner 报障根治）：
		* 块仓照清（中间态无保留价值），成品落「成品仓」（putFile 内驱逐同 app 旧版本
		* ——每应用仅最新版）。失败时块仓不清（chunk 重组仍可兜底）。
		* sha 可传 verifySha256 的 actual（Center 流程）；缺省回落 expectedSha256，
		* 再缺省 `s<size>`（身份键降级，如实不假装）。
		*/
		async persistFile(sha) {
			const bytes = await this.assembleBytes();
			const identity = (sha || this.expectedSha256 || `s${this.size}`).toLowerCase();
			const meta = await this.io.store.putFile({
				appId: this.appId,
				name: this.name,
				size: this.size,
				identity,
				savedAt: this.io.timer.epoch()
			}, bytes);
			await this.io.store.clearPrefix(`${this.name}:${this.size}:`);
			return meta;
		}
		/**
		* 打开/复存直取（零网络零重组）：优先成品仓 getFile；成品被管理器删除后回落
		* chunk 重组（若块仍在仓）；两相皆无→null（调用方回落全新下载）。
		*/
		async openFileFromStore() {
			const f = await this.io.store.getFile(this.appId);
			if (f) return f;
			if (this.size <= 0) return null;
			try {
				const bytes = await this.assembleBytes();
				return {
					key: `file:${this.appId}:`,
					appId: this.appId,
					name: this.name,
					size: bytes.length,
					identity: "",
					savedAt: this.io.timer.epoch(),
					data: bytes
				};
			} catch {
				return null;
			}
		}
		/**
		* sha256 门（三态）：对 / 错 / 缺期望。
		* 期望缺失→no-expected（如实标注）；期望在场而块缺失/哈希不可得→mismatch（fail-closed）。
		* fs 适配有流式 hashOrdered 时走流式；否则整读 crypto.subtle。
		*/
		async verifySha256() {
			const expected = this.expectedSha256 ? this.expectedSha256.toLowerCase() : null;
			if (!expected) return {
				status: "no-expected",
				expected: null,
				actual: null
			};
			let actual = null;
			const keys = Array.from({ length: this.chunkCount() }, (_, i) => this.chunkKey(i));
			if (typeof this.io.store.hashOrdered === "function") actual = await this.io.store.hashOrdered(keys);
			else {
				let len = 0;
				const parts = [];
				let missing = false;
				for (const k of keys) {
					const c = await this.io.store.get(k);
					if (!c) {
						missing = true;
						break;
					}
					const u = c.data instanceof Uint8Array ? c.data : new Uint8Array(await c.data.arrayBuffer());
					parts.push(u);
					len += u.length;
				}
				if (!missing) {
					const all = new Uint8Array(len);
					let off = 0;
					for (const p of parts) {
						all.set(p, off);
						off += p.length;
					}
					actual = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", all)));
				}
			}
			return {
				status: actual === expected ? "match" : "mismatch",
				expected,
				actual
			};
		}
	};
	/** reader 取消卫生（防挂起的 cancel promise 拖住收尾） */
	function quietCancel(reader) {
		try {
			const p = reader.cancel?.();
			if (p && typeof p.catch === "function") p.catch(() => {});
		} catch {}
	}
	// ../../packages/downloader-core/src/adapters/idb.ts
	const DB_NAME = "fde2e-smart-dl";
	const DB_VERSION = 3;
	function idbOpen() {
		return new Promise((res, rej) => {
			const rq = indexedDB.open(DB_NAME, DB_VERSION);
			rq.onupgradeneeded = () => {
				const d = rq.result;
				if (!d.objectStoreNames.contains("chunks")) d.createObjectStore("chunks");
				if (!d.objectStoreNames.contains("tasks")) d.createObjectStore("tasks");
				if (!d.objectStoreNames.contains("files")) d.createObjectStore("files");
			};
			rq.onsuccess = () => res(rq.result);
			rq.onerror = () => rej(rq.error);
			rq.onblocked = () => {
				try {
					console.warn("[fde2e-downloader] idb open blocked：等待旧版本连接释放");
				} catch {}
			};
		});
	}
	function idbPut(db, key, blob) {
		return new Promise((res, rej) => {
			const tx = db.transaction("chunks", "readwrite");
			tx.objectStore("chunks").put(blob, key);
			tx.oncomplete = () => res();
			tx.onerror = () => rej(tx.error);
		});
	}
	function idbGet(db, key) {
		return new Promise((res) => {
			const rq = db.transaction("chunks", "readonly").objectStore("chunks").get(key);
			rq.onsuccess = () => res(rq.result || null);
			rq.onerror = () => res(null);
		});
	}
	function idbClear(db, prefix) {
		return new Promise((res) => {
			const store = db.transaction("chunks", "readwrite").objectStore("chunks");
			const rq = store.openCursor ? store.openCursor() : null;
			if (rq) {
				rq.onsuccess = () => {
					const c = rq.result;
					if (!c) {
						res();
						return;
					}
					if (typeof c.key === "string" && c.key.startsWith(prefix)) c.delete();
					c.continue();
				};
				rq.onerror = () => res();
			} else res();
		});
	}
	function idbPutIn(db, store, key, val) {
		return new Promise((res, rej) => {
			const tx = db.transaction(store, "readwrite");
			tx.objectStore(store).put(val, key);
			tx.oncomplete = () => res();
			tx.onerror = () => rej(tx.error);
		});
	}
	function idbGetIn(db, store, key) {
		return new Promise((res) => {
			const rq = db.transaction(store, "readonly").objectStore(store).get(key);
			rq.onsuccess = () => res(rq.result || null);
			rq.onerror = () => res(null);
		});
	}
	function idbDelIn(db, store, key) {
		return new Promise((res, rej) => {
			const tx = db.transaction(store, "readwrite");
			tx.objectStore(store).delete(key);
			tx.oncomplete = () => res();
			tx.onerror = () => rej(tx.error);
		});
	}
	function idbAllIn(db, store) {
		return new Promise((res) => {
			const rq = db.transaction(store, "readonly").objectStore(store).getAll();
			rq.onsuccess = () => res(rq.result || []);
			rq.onerror = () => res([]);
		});
	}
	function idbPutFile(db, meta, data) {
		return new Promise((res, rej) => {
			const key = fileKeyOf(meta.appId, meta.identity);
			const prefix = fileKeyPrefixOf(meta.appId);
			const tx = db.transaction("files", "readwrite");
			const store = tx.objectStore("files");
			const krq = store.getAllKeys();
			krq.onsuccess = () => {
				for (const k of krq.result) if (typeof k === "string" && k.startsWith(prefix) && k !== key) store.delete(k);
				store.put({
					...meta,
					key,
					blob: data
				}, key);
			};
			tx.oncomplete = () => res({
				...meta,
				key
			});
			tx.onerror = () => rej(tx.error ?? /* @__PURE__ */ new Error("files 事务失败"));
			tx.onabort = () => rej(tx.error ?? /* @__PURE__ */ new Error("files 事务中止"));
		});
	}
	function idbGetFile(db, appId) {
		return new Promise((res) => {
			const store = db.transaction("files", "readonly").objectStore("files");
			const krq = store.getAllKeys();
			krq.onsuccess = () => {
				const key = krq.result.find((k) => typeof k === "string" && k.startsWith(fileKeyPrefixOf(appId)));
				if (key === void 0) return res(null);
				const vrq = store.get(key);
				vrq.onsuccess = () => {
					const r = vrq.result;
					if (!r) return res(null);
					const { blob, ...meta } = r;
					res({
						...meta,
						data: r.blob
					});
				};
				vrq.onerror = () => res(null);
			};
			krq.onerror = () => res(null);
		});
	}
	function idbListFiles(db) {
		return new Promise((res) => {
			const rq = db.transaction("files", "readonly").objectStore("files").getAll();
			rq.onsuccess = () => {
				res((rq.result || []).map(({ blob, ...meta }) => {
					return meta;
				}));
			};
			rq.onerror = () => res([]);
		});
	}
	function idbDelFile(db, appId) {
		return new Promise((res, rej) => {
			const prefix = fileKeyPrefixOf(appId);
			const tx = db.transaction("files", "readwrite");
			const store = tx.objectStore("files");
			const krq = store.getAllKeys();
			krq.onsuccess = () => {
				for (const k of krq.result) if (typeof k === "string" && k.startsWith(prefix)) store.delete(k);
			};
			tx.oncomplete = () => res();
			tx.onerror = () => rej(tx.error ?? /* @__PURE__ */ new Error("files 删除事务失败"));
			tx.onabort = () => rej(tx.error ?? /* @__PURE__ */ new Error("files 删除事务中止"));
		});
	}
	var IdbChunkStore = class {
		db = null;
		async open() {
			this.db = this.db || await idbOpen();
		}
		need() {
			if (!this.db) throw new Error("IdbChunkStore 未 open");
			return this.db;
		}
		async put(key, bytes) {
			const copy = new Uint8Array(bytes.byteLength);
			copy.set(bytes);
			await idbPut(this.need(), key, new Blob([copy.buffer]));
		}
		async get(key) {
			const v = await idbGet(this.need(), key);
			if (!v) return null;
			if (v instanceof Blob) return {
				size: v.size,
				data: v
			};
			return {
				size: v.byteLength,
				data: v
			};
		}
		async clearPrefix(prefix) {
			await idbClear(this.need(), prefix);
		}
		async putFile(meta, bytes) {
			const blob = bytes instanceof Blob ? bytes : new Blob([copyBytes(bytes)]);
			return idbPutFile(this.need(), meta, blob);
		}
		async getFile(appId) {
			return idbGetFile(this.need(), appId);
		}
		async listFiles() {
			return idbListFiles(this.need());
		}
		async delFile(appId) {
			await idbDelFile(this.need(), appId);
		}
		close() {
			try {
				this.db && this.db.close();
			} catch {}
			this.db = null;
		}
	};
	/** 独立 ArrayBuffer 拷贝（TS 的 ArrayBufferLike 泛型对 BlobPart 较严；防外部缓冲区复用） */
	function copyBytes(bytes) {
		const copy = new Uint8Array(bytes.byteLength);
		copy.set(bytes);
		return copy.buffer;
	}
	// ../../packages/downloader-core/src/web.ts
	/**
	* web 挂载层——esbuild bundle 入口（IIFE → site/public/downloads/assets/smart-dl-core.js）
	*
	* 对外 API 冻结（sw.js importScripts 与 smart-dl.js 消费面，逐一与
	* 2026-10-24 版 smart-dl-core.js 对齐——同名同构，零消费方改动）：
	*
	*   self.FDE2ESmartDLCore = {
	*     CHUNK, GLOBAL_CONCURRENCY, PER_SOURCE_CAP, SOURCES, Source, pickWeighted,
	*     Download, fmtBytes, deriveAppId,
	*     idbOpen, idbPut, idbGet, idbClear, idbPutIn, idbGetIn, idbDelIn, idbAllIn,
	*     idbPutFile, idbGetFile, idbListFiles, idbDelFile,   // v0.1.3 成品仓
	*   }
	*
	* Download 在此装配 web 默认 IO（global fetch＋IDB 块仓＋真实时钟），
	* assemble() 保持线上语义：FSA 流式保存优先（用户手势在场），Blob/anchor 兜底。
	* v0.1.2 新增 autoLand()：完成即自动落地（blob a[download] click，无对话框）——
	* run() 成功后由 smart-dl.js 立即调用；assemble() 留给「打开」钮（FSA 另存）。
	* 注意：本入口绝不 import fs 适配（node:fs 不进浏览器 bundle）。
	*/
	const webFetch = (url, init) => fetch(url, init);
	const webTimer = {
		now: () => typeof performance !== "undefined" && performance.now ? performance.now() : Date.now(),
		epoch: () => Date.now(),
		sleep: (ms) => new Promise((r) => setTimeout(r, ms))
	};
	const webAbort = {
		any: (signals) => AbortSignal.any(signals.filter(Boolean)),
		timeout: (ms) => AbortSignal.timeout(ms)
	};
	var WebDownload = class extends Download {
		constructor(opts) {
			super(opts, {
				fetch: webFetch,
				store: new IdbChunkStore(),
				timer: webTimer,
				abort: webAbort,
				random: Math.random
			});
		}
		async assemble() {
			const store = this.io.store;
			const n = this.chunkCount();
			const g = globalThis;
			if (g.showSaveFilePicker && this.userGesture) try {
				const w = await (await g.showSaveFilePicker({ suggestedName: this.name })).createWritable();
				for (let i = 0; i < n; i++) {
					const c = await store.get(this.chunkKey(i));
					if (c) await w.write(c.data);
				}
				await w.close();
				await store.clearPrefix(`${this.name}:${this.size}:`);
				this.closeDb();
				return { via: "fsa" };
			} catch (e) {
				if (e && e.name === "AbortError") throw e;
			}
			const blob = await this.blobFromStore();
			this.anchorClick(blob);
			await store.clearPrefix(`${this.name}:${this.size}:`);
			this.closeDb();
			return {
				via: "blob",
				blob
			};
		}
		/**
		* 完成即自动落地（downloader-straggler-takeover，Owner 2026-10-24）：
		* run() 成功后立即调用——成品入仓（persistFile：组装→putFile 驱逐同 app 旧版→
		* 清块仓，v0.1.3 downloader-cache-retention）→ a[download] click（浏览器默认
		* 下载目录，无对话框；Chrome 单次自动下载无权限拦）。区别于 assemble()：绝不走
		* FSA picker（弹窗＝把用户拦在「等保存」上）。返回**成品仓 blob** 供「打开」钮
		* 复存——不再依赖一次性内存 blob（刷新后 openFileFromStore 仍可直取）。
		*/
		async autoLand() {
			const store = this.io.store;
			await this.persistFile();
			const f = await store.getFile(this.appId);
			if (!f) throw new Error("成品入仓后直取失败（异常态）");
			const blob = f.data instanceof Blob ? f.data : new Blob([new Uint8Array(f.data).buffer]);
			this.anchorClick(blob);
			this.closeDb();
			return blob;
		}
		async blobFromStore() {
			const store = this.io.store;
			const n = this.chunkCount();
			const parts = [];
			for (let i = 0; i < n; i++) {
				const c = await store.get(this.chunkKey(i));
				if (c) parts.push(c.data);
			}
			return new Blob(parts);
		}
		anchorClick(blob) {
			const doc = globalThis.document;
			const a = doc.createElement("a");
			a.href = URL.createObjectURL(blob);
			a.download = this.name;
			doc.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(a.href), 3e4);
		}
	};
	const Core = {
		CHUNK,
		GLOBAL_CONCURRENCY: 6,
		PER_SOURCE_CAP: 3,
		SOURCES,
		Source,
		pickWeighted,
		Download: WebDownload,
		fmtBytes,
		deriveAppId,
		idbOpen,
		idbPut,
		idbGet,
		idbClear,
		idbPutIn,
		idbGetIn,
		idbDelIn,
		idbAllIn,
		idbPutFile,
		idbGetFile,
		idbListFiles,
		idbDelFile
	};
	globalThis.FDE2ESmartDLCore = Core;
	exports.Core = Core;
	exports.WebDownload = WebDownload;
	return exports;
})({});
