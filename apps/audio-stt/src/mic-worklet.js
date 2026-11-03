/**
 * 麦克风 PCM 采集 worklet（tasks 3.3）——128 帧回调聚合成 100ms 块 postMessage。
 * 主线程 ⇄ worklet 协议：{type:"stop"} 停止。纯采集零 DSP（VAD 在主线程引擎侧）。
 */
class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = [];
    this.filled = 0;
    this.target = 1600; // 100ms @16kHz
    this.port.onmessage = (e) => {
      if (e.data?.type === "stop") this.stopped = true;
    };
  }
  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0];
    if (input && input[0]) {
      const ch = input[0];
      for (let i = 0; i < ch.length; i++) {
        this.buf.push(ch[i]);
        this.filled++;
        if (this.filled >= this.target) {
          const out = new Float32Array(this.buf);
          this.buf = [];
          this.filled = 0;
          this.port.postMessage({ type: "pcm", samples: out }, [out.buffer]);
        }
      }
    }
    return true;
  }
}
registerProcessor("mic-capture", MicCapture);
