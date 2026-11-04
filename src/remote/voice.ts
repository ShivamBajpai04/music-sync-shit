import { playerSocketUrl, VOICE_MAX_BUFFER_BYTES, VOICE_MAX_DURATION_MS } from '../shared/voice.ts';
import type { PlayerConnection } from './players.ts';

// One microphone session across every Player card.
let active: (() => void) | null = null;

export function createVoiceControl() {
  const element = document.createElement('div');
  element.className = 'voice';
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg><span>Hold to talk</span>';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  const secureLink = document.createElement('a');
  secureLink.textContent = 'Open secure Remote for microphone access';
  secureLink.hidden = true;
  element.append(button, status, secureLink);
  let player: PlayerConnection;
  let release: (() => void) | null = null;

  async function begin() {
    if (button.disabled || release) return;
    active?.();
    let ended = false;
    let stream: MediaStream | undefined;
    let socket: WebSocket | undefined;
    let node: AudioWorkletNode | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let context: AudioContext | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = (message = '') => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
      source?.disconnect(); node?.disconnect();
      if (context) void context.close().catch(() => {});
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }));
      socket?.close();
      release = null;
      if (active === cancel) active = null;
      button.classList.remove('talking');
      button.setAttribute('aria-pressed', 'false');
      status.textContent = message;
    };
    const cancel = () => stop();
    release = cancel;
    active = cancel;
    status.textContent = 'Connecting…';
    timer = setTimeout(() => stop('Connection timed out. Hold to try again.'), 15_000);
    try {
      // Resume within the user gesture, before waiting for microphone permission.
      context = new AudioContext({ sampleRate: 24_000 });
      await context.resume();
      if (ended) return;
      stream = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      }, video: false });
      if (ended) { stream.getTracks().forEach(track => track.stop()); return; }
      stream.getTracks().forEach(track => { track.onended = () => stop('Microphone disconnected.'); });
      await context.audioWorklet.addModule(new URL('voice-capture.js', location.href));
      if (ended) return;
      node = new AudioWorkletNode(context, 'voice-capture');
      source = context.createMediaStreamSource(stream);
      socket = new WebSocket(playerSocketUrl(location.origin, player.url, true));
      socket.onmessage = event => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === 'error') { stop(message.message); return; }
          if (message.type !== 'ready' || ended || button.classList.contains('talking')) return;
          if (message.sampleRate !== 24000) { stop('Update this Remote to use voice.'); return; }
          clearTimeout(timer);
          timer = setTimeout(() => stop('Time limit reached. Hold to talk again.'), VOICE_MAX_DURATION_MS);
          node!.port.onmessage = event => {
            if (ended || socket?.readyState !== WebSocket.OPEN) return;
            if (socket.bufferedAmount > VOICE_MAX_BUFFER_BYTES) { stop('Connection too slow. Try again.'); return; }
            socket.send(event.data);
          };
          source!.connect(node!);
          node!.connect(context!.destination);
          button.classList.add('talking');
          button.setAttribute('aria-pressed', 'true');
          status.textContent = `Talking to ${player.state?.name ?? player.label}`;
        } catch { stop('Invalid voice response.'); }
      };
      socket.onerror = () => stop('Could not connect to this Mac.');
      socket.onclose = () => { if (!ended) stop('Voice connection ended. Hold to try again.'); };
    } catch (error) {
      stop(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone permission needed. Allow it in site settings, then hold again.'
        : 'Could not start the microphone. Hold to try again.');
    }
  }
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    void begin();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => release?.());
  button.addEventListener('contextmenu', event => event.preventDefault());
  button.addEventListener('keydown', event => {
    if (![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (!event.repeat) void begin();
  });
  button.addEventListener('keyup', event => { if ([' ', 'Enter'].includes(event.key)) release?.(); });
  button.addEventListener('blur', () => release?.());
  const leave = () => release?.();
  const hide = () => { if (document.hidden) leave(); };
  window.addEventListener('blur', leave);
  window.addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', hide);
  return { element, update(next: PlayerConnection) {
    if (player && player.url !== next.url) release?.();
    player = next;
    button.disabled = !isSecureContext || !navigator.mediaDevices || !next.online || !next.state?.voiceAvailable;
    if (button.disabled) release?.();
    button.setAttribute('aria-label', `Hold to talk to ${next.state?.name ?? next.label}`);
    const secure = next.state?.secureRemoteUrl;
    secureLink.hidden = isSecureContext || !secure;
    if (secure) secureLink.href = secure;
    button.title = !isSecureContext ? 'Open the secure Remote to use your microphone'
      : !next.state?.voiceAvailable ? 'Update this Mac’s agent to enable voice' : 'Hold to speak; release to stop';
  }, destroy() {
    leave();
    window.removeEventListener('blur', leave);
    window.removeEventListener('pagehide', leave);
    document.removeEventListener('visibilitychange', hide);
  } };
}
