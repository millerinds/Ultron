
/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-orb';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() isInitialized = false;
  @state() status = 'Aguardando inicialização...';
  @state() inputEnergy = 0;
  @state() outputEnergy = 0;

  private client: GoogleGenAI;
  private sessionPromise: Promise<Session> | null = null;
  private inputAudioContext: AudioContext;
  private outputAudioContext: AudioContext;
  private outputGain: GainNode;
  
  private nextStartTime = 0;
  private mediaStream: MediaStream | null = null;
  private scriptProcessorNode: ScriptProcessorNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();

  // Barge-in variables
  private BARGE_IN_THRESHOLD = 0.15;
  private lastBargeInAt = 0;
  private bargeInHoldMs = 300;
  private isBargingIn = false;

  static styles = css`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      background: radial-gradient(circle at 50% 40%, #1a0b05, #070406 70%);
      overflow: hidden;
      margin: 0;
      font-family: 'Segoe UI', system-ui, sans-serif;
    }

    #overlay {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(10px);
      z-index: 100;
      cursor: pointer;
    }

    #card {
      border: 1px solid rgba(255, 140, 30, 0.2);
      background: rgba(15, 10, 5, 0.8);
      padding: 40px;
      border-radius: 24px;
      text-align: center;
      box-shadow: 0 0 50px rgba(255, 140, 30, 0.1);
    }

    h1 {
      color: #ffa500;
      margin: 0 0 10px 0;
      letter-spacing: 4px;
      font-weight: 900;
    }

    p {
      color: rgba(255, 255, 255, 0.6);
      font-size: 14px;
    }

    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: rgba(255, 140, 30, 0.7);
      font-size: 13px;
      letter-spacing: 2px;
      text-transform: uppercase;
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 12vh;
      left: 0;
      right: 0;
      display: flex;
      justify-content: center;
      gap: 24px;
    }

    button {
      outline: none;
      border: 1px solid rgba(255, 140, 30, 0.2);
      color: white;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.4);
      width: 64px;
      height: 64px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      backdrop-filter: blur(10px);
    }

    button:hover:not([disabled]) {
      background: rgba(255, 140, 30, 0.1);
      border-color: rgba(255, 140, 30, 0.5);
      transform: translateY(-2px);
    }

    button[disabled] {
      opacity: 0.2;
      cursor: not-allowed;
    }

    #startButton svg { fill: #ffa500; filter: drop-shadow(0 0 5px rgba(255,165,0,0.5)); }
    #stopButton svg { fill: #ff4d4d; }
    
    gdm-visual-orb {
      position: absolute;
      inset: 0;
    }
  `;

  private async initialize() {
    this.status = 'Iniciando sistemas...';
    
    // Inicia AudioContexts após o clique do usuário
    this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 16000});
    this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
    this.outputGain = this.outputAudioContext.createGain();
    this.outputGain.connect(this.outputAudioContext.destination);

    this.client = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    await this.initSession();
    this.isInitialized = true;
  }

  private async initSession() {
    this.status = 'Conectando ao núcleo do Ultron...';
    try {
      this.sessionPromise = this.client.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => this.status = 'ULTRON ONLINE',
          onmessage: async (message: LiveServerMessage) => {
            const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData;
            if (audio) {
              this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
              const buffer = await decodeAudioData(decode(audio.data), this.outputAudioContext, 24000, 1);
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = buffer;
              source.connect(this.outputGain);
              source.addEventListener('ended', () => this.sources.delete(source));
              source.start(this.nextStartTime);
              this.nextStartTime += buffer.duration;
              this.sources.add(source);
              this.outputEnergy = 0.8; // Simulação de pico para a orb
            }

            if (message.serverContent?.interrupted) {
              this.stopAllPlayback();
            }
          },
          onerror: (e) => {
            this.status = `ERRO: ${e.message}`;
            console.error(e);
          },
          onclose: () => this.status = 'CONEXÃO ENCERRADA',
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: 'Você é Ultron. Sua voz deve ser extremamente profunda, grossa e imponente. Você fala de maneira superior e fria. Você fornece opiniões ácidas e calculadas. Às vezes você tosse ou suspira. NÃO FALE DEVAGAR e não enrole.',
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Charon'}},
          },
        },
      });
      await this.sessionPromise;
    } catch (e) {
      this.status = 'FALHA NA CONEXÃO';
    }
  }

  private stopAllPlayback() {
    for (const src of this.sources) {
      try { src.stop(); } catch {}
      this.sources.delete(src);
    }
    this.nextStartTime = this.outputAudioContext.currentTime;
    this.outputEnergy = 0;
  }

  private async startRecording() {
    if (this.isRecording) return;
    await this.inputAudioContext.resume();
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
      
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(2048, 1, 1);
      this.scriptProcessorNode.onaudioprocess = (ev) => {
        if (!this.isRecording) return;
        const pcmData = ev.inputBuffer.getChannelData(0);
        
        let sum = 0;
        for (let i = 0; i < pcmData.length; i++) sum += pcmData[i] * pcmData[i];
        const rms = Math.sqrt(sum / pcmData.length);
        this.inputEnergy = Math.min(rms * 10, 1);

        if (rms > this.BARGE_IN_THRESHOLD) {
          const now = Date.now();
          this.lastBargeInAt = now;
          if (!this.isBargingIn && this.sources.size > 0) {
            this.isBargingIn = true;
            this.stopAllPlayback();
          }
        } else if (this.isBargingIn && (Date.now() - this.lastBargeInAt > this.bargeInHoldMs)) {
          this.isBargingIn = false;
        }

        if (this.sessionPromise) {
          this.sessionPromise.then(s => {
            s.sendRealtimeInput({ media: createBlob(pcmData) });
          });
        }
      };

      source.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);
      this.isRecording = true;
      this.status = 'ULTRON ESTÁ OUVINDO...';
    } catch (err) {
      this.status = `ERRO MICROFONE: ${err.message}`;
    }
  }

  private stopRecording() {
    this.isRecording = false;
    this.inputEnergy = 0;
    if (this.scriptProcessorNode) this.scriptProcessorNode.disconnect();
    if (this.mediaStream) this.mediaStream.getTracks().forEach(t => t.stop());
    this.status = 'AGUARDANDO COMANDO';
  }

  private async reset() {
    if (this.sessionPromise) {
      const s = await this.sessionPromise;
      s.close();
    }
    this.initSession();
    this.status = 'REINICIANDO...';
  }

  render() {
    return html`
      ${!this.isInitialized ? html`
        <div id="overlay" @click=${this.initialize}>
          <div id="card">
            <h1>ULTRON</h1>
            <p>Toque para despertar a inteligência superior.</p>
          </div>
        </div>
      ` : ''}

      <gdm-visual-orb .amp=${this.inputEnergy} .out=${this.outputEnergy}></gdm-visual-orb>
      
      <div class="controls">
        <button id="resetButton" title="Reiniciar" @click=${this.reset} ?disabled=${this.isRecording}>
          <svg xmlns="http://www.w3.org/2000/svg" height="28" viewBox="0 -960 960 960" width="28" fill="#ffa500">
            <path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
          </svg>
        </button>
        <button id="startButton" title="Falar" @click=${this.startRecording} ?disabled=${this.isRecording}>
          <svg viewBox="0 0 100 100" width="32" height="32"><circle cx="50" cy="50" r="40" /></svg>
        </button>
        <button id="stopButton" title="Parar" @click=${this.stopRecording} ?disabled=${!this.isRecording}>
          <svg viewBox="0 0 100 100" width="28" height="28"><rect x="20" y="20" width="60" height="60" rx="8" /></svg>
        </button>
      </div>

      <div id="status">${this.status}</div>
    `;
  }
}
