// A small PCM packet every 20 ms. The output remains silent: no microphone echo.
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.offset = 0;
    this.packet = new ArrayBuffer(960);
    this.view = new DataView(this.packet);
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      this.phase += 24000;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      let value = 0;
      for (const channel of channels) value += channel[i];
      value = Math.max(-1, Math.min(1, value / channels.length));
      this.view.setInt16(this.offset, Math.round(value * (value < 0 ? 32768 : 32767)), true);
      this.offset += 2;
      if (this.offset === 960) {
        this.port.postMessage(this.packet, [this.packet]);
        this.packet = new ArrayBuffer(960);
        this.view = new DataView(this.packet);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('voice-capture', VoiceCapture);
