// Hilo de audio del navegador: corre el mezclador del motor (audio_mixer.wasm, el mismo Mixer de
// C++ que en PC) y llena la salida de a 128 muestras. Recibe lotes de comandos del juego y le
// devuelve el estado (reloj, voces y streams vivos, ducking) unas 40 veces por segundo.
class BvMixer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.queue = [];
    this.tick = 0;
    this.load = 0;
    this.port.onmessageerror = () => this.port.postMessage({ error: 'mensaje ilegible' });
    this.port.onmessage = (e) => {
      try {
        this.message(e.data);
      } catch (err) {
        this.port.postMessage({ error: String((err && err.stack) || err) });
      }
    };
  }

  message(d) {
    if (d.init) {
      const module = new WebAssembly.Module(d.bytes);
      const imports = {};
      // Modulo independiente: lo poco que pide del sistema (WASI) no se usa; se completa con nada.
      for (const imp of WebAssembly.Module.imports(module)) {
        imports[imp.module] = imports[imp.module] || {};
        if (imp.kind === 'function') imports[imp.module][imp.name] = () => 0;
      }
      try {
        this.inst = new WebAssembly.Instance(module, imports);
      } catch (err) {
        this.port.postMessage({ error: String(err) });
        return;
      }
      const x = (this.x = this.inst.exports);
      if (x._initialize) x._initialize();
      x.mixer_init(d.rate, 2);
      this.ready = true;
      this.port.postMessage({ ready: true });
      for (const m of this.queue) this.apply(m);
      this.queue = [];
      return;
    }
    if (!this.ready) this.queue.push(d);
    else this.apply(d);
  }

  // Copia el lote y sus archivos a la memoria del modulo (los punteros se piden antes: la memoria
  // puede crecer y cambiar de buffer en cada pedido).
  apply(d) {
    const x = this.x;
    const cmds = new Uint8Array(d.cmds);
    const n = d.blobs.length;
    const cp = x.mixer_alloc(cmds.length);
    const tp = x.mixer_alloc(n * 8 + 8);
    const ptrs = [];
    for (let i = 0; i < n; ++i) ptrs.push(x.mixer_alloc(d.blobs[i].byteLength));
    const heap = new Uint8Array(x.memory.buffer);
    heap.set(cmds, cp);
    const table = new Uint32Array(x.memory.buffer, tp, n * 2);
    for (let i = 0; i < n; ++i) {
      heap.set(new Uint8Array(d.blobs[i]), ptrs[i]);
      table[i * 2] = ptrs[i];
      table[i * 2 + 1] = d.blobs[i].byteLength;
    }
    x.mixer_apply(cp, cmds.length, tp, n);
    x.mixer_free(tp);
  }

  process(inputs, outputs) {
    try {
      return this.mix(outputs);
    } catch (err) {
      if (!this.failed) this.port.postMessage({ error: String(err && err.stack || err) });
      this.failed = true;
      return true;
    }
  }

  mix(outputs) {
    const out = outputs[0];
    if (!this.ready || !out || !out.length) return true;
    const x = this.x;
    const frames = out[0].length;
    const t0 = Date.now();
    const ch = x.mixer_channels();
    const p = x.mixer_render(frames);
    const buf = new Float32Array(x.memory.buffer, p, frames * ch);
    if (out.length >= ch) {
      for (let c = 0; c < ch; ++c) {
        const o = out[c];
        for (let i = 0, j = c; i < frames; ++i, j += ch) o[i] = buf[j];
      }
    } else {
      // Surround en una salida estereo: se baja (centro y traseros a cada lado).
      const l = out[0], r = out[1] || out[0];
      for (let i = 0, j = 0; i < frames; ++i, j += ch) {
        let a = buf[j] + 0.7071 * (buf[j + 2] + buf[j + 4]);
        let b = buf[j + 1] + 0.7071 * (buf[j + 2] + buf[j + 5]);
        if (ch === 8) { a += 0.7071 * buf[j + 6]; b += 0.7071 * buf[j + 7]; }
        l[i] = a;
        r[i] = b;
      }
    }
    this.load += ((Date.now() - t0) / (1000 * frames / sampleRate) - this.load) * 0.02;
    if (++this.tick % 8 === 0) {
      const sp = x.mixer_status(), size = x.mixer_status_size();
      const st = x.memory.buffer.slice(sp, sp + size);
      new Float32Array(st, x.mixer_status_cpu(), 1)[0] = this.load;
      this.port.postMessage({ status: st }, [st]);
    }
    return true;
  }
}

registerProcessor('bv-mixer', BvMixer);
