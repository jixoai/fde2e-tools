// AudioWorklet 消息协议（mic-capture.worklet.js ↔ 主线程）
export {};
declare global {
  interface Window {
    __sttMicWorklet?: string;
  }
}
