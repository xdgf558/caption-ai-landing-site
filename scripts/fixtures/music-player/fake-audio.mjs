// Native-media test double shared by core and queue tests.
export class Audio extends EventTarget {
  constructor() {
    super(); this.volume = 1; this.muted = false; this.currentSrc = ''; this.src = ''; this.currentTime = 0;
    this.duration = NaN; this.readyState = 0; this.paused = true; this.ended = false; this.error = null;
    this.seekable = { length: 0 }; this.plays = []; this.loads = 0;
  }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  load() { this.loads++; this.currentSrc = ''; this.currentTime = 0; this.readyState = 0; this.duration = NaN; this.error = null; this.ended = false; }
  play() {
    this.paused = false;
    return new Promise((resolve, reject) => this.plays.push({ resolve, reject }));
  }
  pause() { this.paused = true; }
  emit(event) { this.dispatchEvent(new Event(event)); }
  metadata(duration = 222) {
    this.currentSrc = this.src; this.readyState = 1; this.duration = duration;
    this.seekable = { length: 1, start: () => 0, end: () => duration };
    this.emit('loadedmetadata');
  }
  playing() { this.readyState = 4; this.paused = false; this.emit('playing'); }
}
