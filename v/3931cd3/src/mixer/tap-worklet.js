// AudioWorklet that copies the master bus to the main thread for WAV recording.
class DjkeladTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 4096;
    this.l = new Float32Array(this.size);
    this.r = new Float32Array(this.size);
    this.n = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        this.flush();
        this.port.postMessage('flushed');
      }
    };
  }

  flush() {
    if (this.n > 0) {
      this.port.postMessage([this.l.slice(0, this.n), this.r.slice(0, this.n)]);
      this.n = 0;
    }
  }

  process(inputs) {
    const input = inputs[0];
    const frames = input && input[0] ? input[0].length : 128;
    const L = input && input[0];
    const R = (input && input[1]) || L;
    for (let i = 0; i < frames; i++) {
      // A silent graph can deliver zero channels: record real silence, keep the timeline.
      this.l[this.n] = L ? L[i] : 0;
      this.r[this.n] = R ? R[i] : 0;
      this.n++;
      if (this.n === this.size) this.flush();
    }
    return true;
  }
}

registerProcessor('djkelad-tap', DjkeladTap);
