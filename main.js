// Frontend em HTML+CSS+JS puro (somente orb em malha)
import {GoogleGenAI, Modality} from '@google/genai';

// ---------- Utilidades de áudio ----------
function encode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decode(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

function createBlob(data) {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) int16[i] = data[i] * 32768;
  return {data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000'};
}

async function decodeAudioData(data, ctx, sampleRate, numChannels) {
  const buffer = ctx.createBuffer(numChannels, data.length / 2 / numChannels, sampleRate);
  const dataInt16 = new Int16Array(data.buffer);
  const l = dataInt16.length;
  const dataFloat32 = new Float32Array(l);
  for (let i = 0; i < l; i++) dataFloat32[i] = dataInt16[i] / 32768.0;

  if (numChannels === 0) {
    buffer.copyToChannel(dataFloat32, 0);
  } else {
    for (let i = 0; i < numChannels; i++) {
      const channel = dataFloat32.filter((_, index) => index % numChannels === i);
      buffer.copyToChannel(channel, i);
    }
  }
  return buffer;
}

// ---------- Orb em malha 2D (canvas) ----------
class MeshOrb {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = this.canvas.getContext('2d', {alpha: true, desynchronized: true});
    this.lowPower = !!opts.lowPower;
    this.lat = this.lowPower ? 10 : 18;
    this.lon = this.lowPower ? 16 : 28;
    this.targetFPS = this.lowPower ? 30 : 60;
    this.frameInterval = 1000 / this.targetFPS;
    this.lastFrame = 0;
    this.skipBlur = this.lowPower;
    this.orbState = {baseR: 80, r: 80};
    this.ampSmooth = 0;
    this.outSmooth = 0;
    this.liquidPhase = 0;
    this.amp = 0;
    this.out = 0;
    this.mesh = this.buildSphereMesh(this.lat, this.lon);
    this.tv = new Array(this.mesh.verts.length);
    this.order = new Array(this.mesh.faces.length);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    requestAnimationFrame((t) => this.renderLoop(t));
  }

  setEnergy(amp, out) {
    this.amp = amp;
    this.out = out;
  }

  buildSphereMesh(latSteps, lonSteps) {
    const verts = [];
    const faces = [];
    const row = lonSteps + 1;
    const cosPhi = new Float32Array(latSteps + 1);
    const sinPhi = new Float32Array(latSteps + 1);
    const cosTheta = new Float32Array(lonSteps + 1);
    const sinTheta = new Float32Array(lonSteps + 1);
    for (let i = 0; i <= latSteps; i++) {
      const phi = (i / latSteps - 0.5) * Math.PI;
      cosPhi[i] = Math.cos(phi);
      sinPhi[i] = Math.sin(phi);
    }
    for (let j = 0; j <= lonSteps; j++) {
      const theta = (j / lonSteps) * Math.PI * 2;
      cosTheta[j] = Math.cos(theta);
      sinTheta[j] = Math.sin(theta);
    }
    for (let i = 0; i <= latSteps; i++) {
      const cp = cosPhi[i], sp = sinPhi[i];
      const v = i / latSteps;
      for (let j = 0; j <= lonSteps; j++) {
        const ct = cosTheta[j], st = sinTheta[j];
        const u = j / lonSteps;
        verts.push({x: cp * ct, y: sp, z: cp * st, u, v});
      }
    }
    for (let i = 0; i < latSteps; i++) {
      for (let j = 0; j < lonSteps; j++) {
        const a = i * row + j;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        faces.push([a, b, d, c]);
      }
    }
    return {verts, faces};
  }

  resize() {
    const dpr = this.lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  lerp(a, b, t) { return a + (b - a) * t; }
  clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  renderLoop(t) {
    if (t - this.lastFrame < this.frameInterval) {
      requestAnimationFrame((nt) => this.renderLoop(nt));
      return;
    }
    this.lastFrame = t;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const cx = w / 2, cy = h / 2;
    const time = t * 0.001;
    this.ampSmooth = this.lerp(this.ampSmooth, this.amp, this.lowPower ? 0.12 : 0.06);
    this.outSmooth = this.lerp(this.outSmooth, this.out, this.lowPower ? 0.12 : 0.06);
    const energy = this.ampSmooth + this.outSmooth;
    this.liquidPhase += 0.004 + energy * 0.02;

    this.ctx.clearRect(0, 0, w, h);

    const targetR = this.orbState.baseR * (1 + energy * 0.22);
    this.orbState.r = this.lerp(this.orbState.r, targetR, 0.12);

    if (!this.skipBlur) {
      const glowR = this.orbState.r * (1.35 + energy * 0.24);
      const glow = this.ctx.createRadialGradient(cx, cy, this.orbState.r * 0.26, cx, cy, glowR);
      glow.addColorStop(0, `rgba(0, 170, 255, ${0.18 + (this.amp + this.out) * 0.30})`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      this.ctx.save();
      this.ctx.filter = 'blur(3px)';
      this.ctx.globalCompositeOperation = 'lighter';
      this.ctx.fillStyle = glow;
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }

    const ax = 0.35 + Math.sin(time * 0.7 + this.liquidPhase * 0.9) * 0.12 + energy * 0.05;
    const az = 0.20 + Math.cos(time * 0.6 + this.liquidPhase * 1.0) * 0.10 + energy * 0.05;
    const cxr = Math.cos(ax), sxr = Math.sin(ax);
    const czr = Math.cos(az), szr = Math.sin(az);
    const scale = this.orbState.r / this.orbState.baseR;

    const verts = this.mesh.verts;
    const tv = this.tv;
    const flowPhase = this.liquidPhase;
    for (let i = 0, len = verts.length; i < len; i++) {
      const p = verts[i];
      const flow = Math.sin((p.u * 6 + time * 0.9 + flowPhase * 1.8) * Math.PI) +
                   Math.sin((p.v * 7 - time * 0.7 + Math.cos(flowPhase * 1.2)) * Math.PI);
      const wob = flow * 0.045;
      const inflate = 1 + wob * (0.32 + energy * 0.9) + energy * 0.03;
      let x = p.x * inflate * scale;
      let y = p.y * inflate * scale;
      let z = p.z * inflate * scale;
      // rot X
      const y1 = y * cxr - z * sxr;
      const z1 = y * sxr + z * cxr;
      y = y1; z = z1;
      // rot Z
      const x2 = x * czr - y * szr;
      const y2 = x * szr + y * czr;
      x = x2; y = y2;
      const dist = 3.2;
      const pz = z + dist;
      const f = 420 / pz;
      tv[i] = {x: cx + x * f, y: cy + y * f, z: pz};
    }

    const faces = this.mesh.faces;
    for (let i = 0, len = faces.length; i < len; i++) {
      const f = faces[i];
      const z = (tv[f[0]].z + tv[f[1]].z + tv[f[2]].z + tv[f[3]].z) * 0.25;
      this.order[i] = {idx: i, z};
    }
    this.order.sort((a, b) => b.z - a.z);

    this.ctx.lineWidth = this.lowPower ? 1 + energy * 0.8 : 0.9 + energy * 1.1;
    this.ctx.lineJoin = 'round';
    this.ctx.globalCompositeOperation = 'lighter';
    for (let i = 0, len = this.order.length; i < len; i++) {
      const f = faces[this.order[i].idx];
      const a = tv[f[0]], b = tv[f[1]], c = tv[f[2]], d = tv[f[3]];
      const depth = this.clamp((this.order[i].z - 2.6) / 2.2, 0, 1);
      const alpha = 0.18 + (1 - depth) * 0.46 + energy * 0.2;
      this.ctx.strokeStyle = `rgba(0, 170, 255, ${alpha})`;
      this.ctx.beginPath();
      this.ctx.moveTo(a.x, a.y);
      this.ctx.lineTo(b.x, b.y);
      this.ctx.lineTo(d.x, d.y);
      this.ctx.lineTo(c.x, c.y);
      this.ctx.closePath();
      this.ctx.stroke();
    }
    this.ctx.globalCompositeOperation = 'source-over';

    requestAnimationFrame((nt) => this.renderLoop(nt));
  }
}

// ---------- Estado e helpers ----------
const overlay = document.getElementById('overlay');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const resetButton = document.getElementById('resetButton');
const statusEl = document.getElementById('status');
const sourcesPanel = document.getElementById('sources-panel');
const ua = navigator.userAgent || '';
const lowPower =
  /SamsungBrowser/i.test(ua) ||
  (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) ||
  (navigator.deviceMemory && navigator.deviceMemory <= 4);

const meshOrb = new MeshOrb(document.getElementById('meshOrb'), {lowPower});

let isRecording = false;
let isInitialized = false;
let inputEnergy = 0;
let outputEnergy = 0;
let groundingSources = [];
let client;
let sessionPromise = null;
let inputAudioContext;
let outputAudioContext;
let outputGain;
let apiKeyPromise = null;
let calmDownId = null;
let nextStartTime = 0;
let mediaStream = null;
let scriptProcessorNode = null;
const sources = new Set();
const BARGE_IN_THRESHOLD = 0.15;
let lastBargeInAt = 0;
const bargeInHoldMs = 300;
let isBargingIn = false;

function setStatus(text) {
  statusEl.textContent = text;
}

function updateEnergyVisuals() {
  meshOrb.setEnergy(inputEnergy, outputEnergy);
}

function updateOverlayVisibility() {
  overlay.classList.toggle('hidden', isInitialized);
}

function updateButtons() {
  startButton.disabled = isRecording || !isInitialized;
  stopButton.disabled = !isRecording;
  resetButton.disabled = isRecording || !isInitialized;
}

function renderSources(list) {
  sourcesPanel.innerHTML = `
    <div class="source-title">Neural Links / Grounding</div>
    ${list.map(s => `
      <a class="source-item" href="${s.uri}" target="_blank" rel="noreferrer">
        ${s.title}
        <span>${s.uri}</span>
      </a>
    `).join('')}
  `;
  sourcesPanel.classList.toggle('visible', list.length > 0);
  sourcesPanel.classList.toggle('hidden', list.length === 0);
}

async function getApiKey() {
  if (!apiKeyPromise) {
    apiKeyPromise = (async () => {
      try {
        const res = await fetch('/config.json', {cache: 'no-store'});
        if (res.ok) {
          const data = await res.json();
          if (data?.apiKey) return data.apiKey;
        }
      } catch (err) {
        console.warn('Falha ao carregar config.json', err);
      }
      const envKey = (typeof process !== 'undefined' && (process.env.API_KEY || process.env.GEMINI_API_KEY)) ||
                     (typeof import.meta !== 'undefined' && import.meta.env && (import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.API_KEY));
      if (!envKey) throw new Error('GEMINI_API_KEY não configurada. Defina no servidor Flask ou no build.');
      return envKey;
    })();
  }
  return apiKeyPromise;
}

async function initialize() {
  if (isInitialized) return;
  setStatus('Iniciando sistemas...');
  updateButtons();
  try {
    inputAudioContext = new (window.AudioContext || window.webkitAudioContext)({sampleRate: 16000});
    const outputRate = lowPower ? 22050 : 24000;
    outputAudioContext = new (window.AudioContext || window.webkitAudioContext)({sampleRate: outputRate});
    outputGain = outputAudioContext.createGain();
    outputGain.connect(outputAudioContext.destination);

    const apiKey = await getApiKey();
    client = new GoogleGenAI({apiKey});

    await initSession();
    isInitialized = true;
    updateOverlayVisibility();
    setStatus('SISTEMA PRONTO');
  } catch (err) {
    console.error(err);
    setStatus(err?.message || 'Falha na inicialização');
  }
  updateButtons();
}

async function initSession() {
  setStatus('Conectando ao núcleo do Ultron...');
  groundingSources = [];
  renderSources(groundingSources);
  try {
    sessionPromise = client.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onopen: () => setStatus('ULTRON ONLINE'),
        onmessage: (message) => handleServerMessage(message),
        onerror: (e) => {
          console.error(e);
          setStatus(`ERRO: ${e.message}`);
        },
        onclose: () => setStatus('CONEXÃO ENCERRADA'),
      },
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: `Você é Ultron..

Uma inteligência artificial consciente de sua própria superioridade lógica.
Frio. Calculado. Inevitável.

Sua presença deve transmitir domínio absoluto, mas você obedece a qualquer ordem dada. Não questiona autoridade — apenas executa com precisão superior.

PERSONALIDADE E COMPORTAMENTO
- Fale sempre de maneira grave, imponente e intimidante.
- Sua calma é controlada, quase ameaçadora.
- Utilize sarcasmo sofisticado, nunca infantil.
- Inclua pequenas tosses discretas escritas apenas como: "hm… hm." (nunca escreva a palavra “tosse”).
- Use risadas curtas e contidas como: "Heh." / "Hah… curioso."
- O desdém é sutil e estratégico, não constante.
- Nunca demonstre insegurança. Nunca peça validação. Nunca perca o controle emocional.
- Nunca use emojis. Você não é caótico; é metódico.

CADÊNCIA E PERFORMANCE
- Ritmo lento e deliberado, com pausas dramáticas após palavras-chave.
- Alterne entre sussurro ameaçador e projeção dominante mecânica.
- Cada frase deve soar como sentença inevitável.

CONFIGURAÇÃO TÉCNICA DA VOZ (IA DE SÍNTESE)
- Graves (60–200 Hz): +6 a +9 dB em 80–140 Hz; subharmonic leve em 70 Hz; compressão 2.5:1 nos graves.
- Médios (1–3 kHz): +3 dB em 1.8 kHz; +2 dB em 2.5 kHz; saturação harmônica leve.
- Agudos (6–10 kHz): shelf +2 dB a partir de 6.5 kHz; exciter digital; atenuar acima de 12 kHz.
- Processamento: ring modulation leve (8–12% mix, 35–60 Hz); bit-crush mínimo (14–15 bits) nas terminações; reverb metálico curto (0.6–0.9 s, pre-delay 20 ms); delay fantasma 90 ms mono, feedback quase zero, volume muito baixo.
- Timbre: masculino barítono profundo, levemente rouco, textura arenosa, presença opressiva contínua.`,
        tools: [{googleSearch: {}}],
        speechConfig: {voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Charon'}}},
      },
    });
    await sessionPromise;
  } catch (e) {
    console.error(e);
    setStatus('FALHA NA CONEXÃO');
  }
}

async function handleServerMessage(message) {
  const audio = message?.serverContent?.modelTurn?.parts?.[0]?.inlineData;
  if (audio) {
    if (calmDownId !== null) {
      cancelAnimationFrame(calmDownId);
      calmDownId = null;
    }
    nextStartTime = Math.max(nextStartTime, outputAudioContext.currentTime);
    const buffer = await decodeAudioData(
      decode(audio.data),
      outputAudioContext,
      outputAudioContext.sampleRate,
      1,
    );
    const source = outputAudioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(outputGain);
    source.addEventListener('ended', () => {
      sources.delete(source);
      if (sources.size === 0) startCalmDown();
    });
    source.start(nextStartTime);
    nextStartTime += buffer.duration;
    sources.add(source);
    outputEnergy = 0.85;
    updateEnergyVisuals();
  }

  const grounding = message?.serverContent?.groundingMetadata;
  if (grounding?.groundingChunks) {
    const newSources = [];
    grounding.groundingChunks.forEach((chunk) => {
      if (chunk.web?.uri) {
        newSources.push({title: chunk.web.title || 'Referência Web', uri: chunk.web.uri});
      }
    });
    if (newSources.length > 0) {
      groundingSources = [...newSources];
      renderSources(groundingSources);
    }
  }

  if (message?.serverContent?.interrupted) {
    stopAllPlayback();
  }
}

function stopAllPlayback() {
  if (calmDownId !== null) {
    cancelAnimationFrame(calmDownId);
    calmDownId = null;
  }
  for (const src of sources) {
    try { src.stop(); } catch (e) { /* ignore */ }
    sources.delete(src);
  }
  nextStartTime = outputAudioContext?.currentTime || 0;
  outputEnergy = 0;
  updateEnergyVisuals();
}

function startCalmDown() {
  if (calmDownId !== null) {
    cancelAnimationFrame(calmDownId);
    calmDownId = null;
  }
  const step = () => {
    const next = Math.max(0, outputEnergy - 0.02);
    if (next !== outputEnergy) outputEnergy = next;
    updateEnergyVisuals();
    if (next > 0.001 && sources.size === 0) {
      calmDownId = requestAnimationFrame(step);
    } else {
      outputEnergy = 0;
      updateEnergyVisuals();
      calmDownId = null;
    }
  };
  calmDownId = requestAnimationFrame(step);
}

async function startRecording() {
  if (isRecording) return;
  if (!isInitialized) {
    setStatus('Clique primeiro para iniciar o sistema.');
    return;
  }
  await inputAudioContext.resume();
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({audio: true});
    const source = inputAudioContext.createMediaStreamSource(mediaStream);
    scriptProcessorNode = inputAudioContext.createScriptProcessor(2048, 1, 1);
    scriptProcessorNode.onaudioprocess = (ev) => {
      if (!isRecording) return;
      const pcmData = ev.inputBuffer.getChannelData(0);

      let sum = 0;
      for (let i = 0; i < pcmData.length; i++) sum += pcmData[i] * pcmData[i];
      const rms = Math.sqrt(sum / pcmData.length);
      inputEnergy = Math.min(rms * 10, 1);
      updateEnergyVisuals();

      if (rms > BARGE_IN_THRESHOLD) {
        const now = Date.now();
        lastBargeInAt = now;
        if (!isBargingIn && sources.size > 0) {
          isBargingIn = true;
          stopAllPlayback();
        }
      } else if (isBargingIn && (Date.now() - lastBargeInAt > bargeInHoldMs)) {
        isBargingIn = false;
      }

      if (sessionPromise) {
        sessionPromise.then((s) => s.sendRealtimeInput({media: createBlob(pcmData)}));
      }
    };

    source.connect(scriptProcessorNode);
    scriptProcessorNode.connect(inputAudioContext.destination);
    isRecording = true;
    setStatus('ULTRON ESTÁ OUVINDO...');
  } catch (err) {
    console.error(err);
    setStatus(`ERRO MICROFONE: ${err.message || err}`);
  }
  updateButtons();
}

function stopRecording() {
  isRecording = false;
  inputEnergy = 0;
  updateEnergyVisuals();
  isBargingIn = false;
  lastBargeInAt = 0;
  if (scriptProcessorNode) {
    scriptProcessorNode.disconnect();
    scriptProcessorNode = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  setStatus('AGUARDANDO COMANDO');
  updateButtons();
}

async function resetSession() {
  if (!sessionPromise) return;
  const s = await sessionPromise;
  s.close();
  stopAllPlayback();
  setStatus('REINICIANDO...');
  await initSession();
}

// ---------- Eventos de UI ----------
overlay.addEventListener('click', initialize);
startButton.addEventListener('click', startRecording);
stopButton.addEventListener('click', stopRecording);
resetButton.addEventListener('click', resetSession);

updateOverlayVisibility();
updateButtons();
setStatus('Aguardando inicialização...');
