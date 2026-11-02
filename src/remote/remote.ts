import {
  REMOTE_PATH,
  SOURCE_LABELS,
  advance,
  type AgentToRemote,
  type PlayerState,
  type RemoteToAgent,
  type SourceCommand,
} from '../shared/protocol.ts';

const RECONNECT_MS = 2_000;
const TICK_MS = 250;
const container = document.getElementById('players')!;

function connectPlayer(url: string) {
  let socket: WebSocket | null = null;
  let state: PlayerState | null = null;
  let receivedAt = 0;
  // While a slider is held, incoming state doesn't move it.
  let seeking = false;
  let adjustingVolume = false;

  const card = el('section', '', 'card');
  const name = el('h2', 'Player');
  const status = el('span', '', 'status');
  const header = el('header');
  header.append(name, status);

  const art = document.createElement('img');
  art.className = 'art';
  art.alt = '';
  const title = el('div', '', 'title');
  const artist = el('div', '', 'artist');
  const source = el('div', '', 'source');
  const meta = el('div', '', 'meta');
  meta.append(title, artist, source);
  const empty = el('div', '', 'empty');
  const now = el('div', '', 'now');
  now.append(art, meta, empty);

  const position = el('span', '0:00', 'time');
  const duration = el('span', '0:00', 'time');
  const seekBar = slider('Seek');
  seekBar.addEventListener('input', () => {
    seeking = true;
    position.textContent = clock(Number(seekBar.value));
  });
  seekBar.addEventListener('change', () => {
    seeking = false;
    command({ type: 'seek', positionMs: Number(seekBar.value) });
  });
  const progressRow = el('div', '', 'progress');
  progressRow.append(position, seekBar, duration);

  const previous = button('⏮', 'Previous', () => command({ type: 'previous' }));
  const playPause = button('▶', 'Play', () => command({ type: state?.playing ? 'pause' : 'play' }));
  playPause.classList.add('play-pause');
  const next = button('⏭', 'Next', () => command({ type: 'next' }));
  const controls = el('div', '', 'controls');
  controls.append(previous, playPause, next);

  const volume = slider('Volume');
  volume.max = '100';
  volume.addEventListener('input', () => (adjustingVolume = true));
  volume.addEventListener('change', () => {
    adjustingVolume = false;
    send({ type: 'set-volume', volume: Number(volume.value) });
  });
  const volumeRow = el('label', '', 'volume');
  volumeRow.append(el('span', '🔈'), volume, el('span', '🔊'));

  card.append(header, now, progressRow, controls, volumeRow);
  container.append(card);

  function render() {
    const online = socket?.readyState === WebSocket.OPEN && state !== null;
    name.textContent = state?.name ?? 'Player';
    status.textContent = online ? 'Online' : 'Unavailable';
    status.className = `status ${online ? 'online' : 'offline'}`;

    const track = online ? state!.track : null;
    art.hidden = meta.hidden = !track;
    empty.hidden = !!track;
    if (track) {
      if (track.artUrl && art.src !== track.artUrl) art.src = track.artUrl;
      if (!track.artUrl) art.removeAttribute('src');
      title.textContent = track.title;
      artist.textContent = track.artist;
      source.textContent = state!.source ? SOURCE_LABELS[state!.source] : '';
    } else {
      empty.textContent = online ? (state?.source ? 'Nothing playing' : 'No Source tab open') : '';
    }

    const hasSource = online && !!state?.source;
    for (const control of [previous, playPause, next]) control.disabled = !hasSource;
    const playing = hasSource && state!.playing;
    playPause.textContent = playing ? '❚❚' : '▶';
    playPause.setAttribute('aria-label', playing ? 'Pause' : 'Play');

    renderProgress();

    volume.disabled = !online || state?.volume === null;
    if (!adjustingVolume && state?.volume != null) volume.value = String(state.volume);
  }

  function renderProgress() {
    const progress = state?.progress && socket?.readyState === WebSocket.OPEN
      ? advance(state.progress, state.playing, Date.now() - receivedAt)
      : null;
    seekBar.disabled = !progress;
    if (seeking) return;
    seekBar.max = String(progress?.durationMs ?? 0);
    seekBar.value = String(progress?.positionMs ?? 0);
    position.textContent = clock(progress?.positionMs ?? 0);
    duration.textContent = clock(progress?.durationMs ?? 0);
  }

  function command(command: SourceCommand) {
    send({ type: 'command', command });
  }

  function send(message: RemoteToAgent) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function connect() {
    socket = new WebSocket(url);
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as AgentToRemote;
      if (message.type === 'state') {
        state = message.state;
        receivedAt = Date.now();
      }
      render();
    };
    socket.onclose = () => {
      render();
      setTimeout(connect, RECONNECT_MS);
    };
  }

  setInterval(renderProgress, TICK_MS);
  render();
  connect();
}

function el(tag: string, text = '', className = '') {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text: string, label: string, onClick: () => void) {
  const node = document.createElement('button');
  node.textContent = text;
  node.setAttribute('aria-label', label);
  node.onclick = onClick;
  return node;
}

function slider(label: string) {
  const node = document.createElement('input');
  node.type = 'range';
  node.min = '0';
  node.setAttribute('aria-label', label);
  return node;
}

function clock(ms: number) {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// One Player for now: the agent that served this page.
connectPlayer(`ws://${location.host}${REMOTE_PATH}`);
