import { REMOTE_PATH, SOURCE_LABELS, type AgentToRemote, type PlayerState, type RemoteToAgent } from '../shared/protocol.ts';

const RECONNECT_MS = 2_000;
const container = document.getElementById('players')!;

function connectPlayer(url: string) {
  const card = document.createElement('section');
  card.className = 'card';
  container.append(card);
  let socket: WebSocket | null = null;
  let state: PlayerState | null = null;

  function render() {
    const online = socket?.readyState === WebSocket.OPEN && state !== null;
    card.replaceChildren();

    const header = el('header');
    header.append(el('h2', state?.name ?? 'Player'), el('span', online ? 'Online' : 'Unavailable', `status ${online ? 'online' : 'offline'}`));
    card.append(header);

    const now = el('div', '', 'now');
    if (online && state?.track) {
      const art = document.createElement('img');
      art.className = 'art';
      art.alt = '';
      if (state.track.artUrl) art.src = state.track.artUrl;
      const meta = el('div', '', 'meta');
      meta.append(
        el('div', state.track.title, 'title'),
        el('div', state.track.artist, 'artist'),
        el('div', state.source ? SOURCE_LABELS[state.source] : '', 'source'),
      );
      now.append(art, meta);
    } else {
      now.append(el('div', online ? (state?.source ? 'Nothing playing' : 'No Source tab open') : '', 'empty'));
    }
    card.append(now);

    const controls = el('div', '', 'controls');
    const button = document.createElement('button');
    button.className = 'play-pause';
    const playing = online && state!.playing;
    button.textContent = playing ? '❚❚' : '▶';
    button.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    button.disabled = !online || !state?.source;
    button.onclick = () => send({ type: 'command', command: { type: playing ? 'pause' : 'play' } });
    controls.append(button);
    card.append(controls);
  }

  function send(message: RemoteToAgent) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function connect() {
    socket = new WebSocket(url);
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as AgentToRemote;
      if (message.type === 'state') state = message.state;
      render();
    };
    socket.onclose = () => {
      render();
      setTimeout(connect, RECONNECT_MS);
    };
  }

  render();
  connect();
}

function el(tag: string, text = '', className = '') {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

// One Player for now: the agent that served this page.
connectPlayer(`ws://${location.host}${REMOTE_PATH}`);
