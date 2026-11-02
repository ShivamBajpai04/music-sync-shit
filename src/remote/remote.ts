import { SOURCE_LABELS, advance, type RemoteToAgent, type SourceCommand, type SourceId, type SourceState } from '../shared/protocol.ts';
import { watchPlayers, type PlayerConnection } from './players.ts';

const TICK_MS = 250;
const container = document.getElementById('players')!;

// One group per Player: its name, status and the Mac's volume, then a card
// per Source the agent lists.
function createPlayerGroup() {
  let player: PlayerConnection | null = null;
  // While the slider is held, incoming state doesn't move it.
  let adjustingVolume = false;

  const element = el('section', '', 'player');
  const name = el('h2', 'Player');
  const status = el('span', '', 'status');
  const header = el('header');
  header.append(name, status);

  const volume = slider('Volume');
  volume.max = '100';
  volume.addEventListener('input', () => (adjustingVolume = true));
  volume.addEventListener('change', () => {
    adjustingVolume = false;
    player?.send({ type: 'set-volume', volume: Number(volume.value) });
  });
  const volumeRow = el('label', '', 'volume');
  volumeRow.append(el('span', '🔈'), volume, el('span', '🔊'));

  const link = document.createElement('input');
  link.type = 'url';
  link.placeholder = 'Paste a Spotify or YouTube Music link';
  link.setAttribute('aria-label', 'Link to play');
  const start = button('Play', 'Play link', () => {});
  start.type = 'submit';
  const linkForm = document.createElement('form');
  linkForm.className = 'link';
  linkForm.append(link, start);
  linkForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!link.value.trim()) return;
    player?.send({ type: 'start-link', link: link.value });
    link.value = '';
  });
  const error = el('div', '', 'error');

  const cardList = el('div', '', 'cards');
  element.append(header, volumeRow, linkForm, error, cardList);
  const cards = new Map<SourceId | 'none', ReturnType<typeof createCard>>();

  function update(next: PlayerConnection) {
    player = next;
    const { online, state } = player;
    name.textContent = state?.name ?? player.label;
    status.textContent = online ? 'Online' : 'Unavailable';
    status.className = `status ${online ? 'online' : 'offline'}`;
    element.classList.toggle('offline', !online);

    link.disabled = start.disabled = !online;
    error.textContent = player.error ?? '';
    error.hidden = !player.error;

    volume.disabled = !online || state?.volume == null;
    if (!adjustingVolume && state?.volume != null) volume.value = String(state.volume);

    const shown: (SourceState | null)[] = online && state!.sources.length ? state!.sources : [null];
    const keys = shown.map((card) => card?.source ?? 'none');
    for (const [key, card] of cards) {
      if (!keys.includes(key)) {
        card.element.remove();
        cards.delete(key);
      }
    }
    shown.forEach((source, index) => {
      const key = keys[index];
      let card = cards.get(key);
      if (!card) {
        card = createCard((message) => player?.send(message));
        cards.set(key, card);
      }
      // Keeps the cards in SOURCE_ORDER; a no-op when already in place.
      if (cardList.children[index] !== card.element) {
        cardList.insertBefore(card.element, cardList.children[index] ?? null);
      }
      card.update(online, source, player!.receivedAt);
    });
  }

  function tick() {
    for (const card of cards.values()) card.tick();
  }

  return { element, update, tick };
}

function createCard(send: (message: RemoteToAgent) => void) {
  let online = false;
  // null for the placeholder card shown when no Source tab is open.
  let card: SourceState | null = null;
  let receivedAt = 0;
  // While the slider is held, incoming state doesn't move it.
  let seeking = false;

  const element = el('div', '', 'card');
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
  const playPause = button('▶', 'Play', () => command({ type: card?.playing ? 'pause' : 'play' }));
  playPause.classList.add('play-pause');
  const next = button('⏭', 'Next', () => command({ type: 'next' }));
  const controls = el('div', '', 'controls');
  controls.append(previous, playPause, next);

  element.append(now, progressRow, controls);

  function command(command: SourceCommand) {
    if (card) send({ type: 'command', source: card.source, command });
  }

  function update(isOnline: boolean, state: SourceState | null, at: number) {
    online = isOnline;
    card = state;
    receivedAt = at;

    const track = card?.track ?? null;
    art.hidden = meta.hidden = !track;
    empty.hidden = !!track;
    if (track) {
      if (track.artUrl && art.src !== track.artUrl) art.src = track.artUrl;
      if (!track.artUrl) art.removeAttribute('src');
      title.textContent = track.title;
      artist.textContent = track.artist;
      source.textContent = SOURCE_LABELS[card!.source];
    } else {
      empty.textContent = !online ? '' : card ? `Nothing playing on ${SOURCE_LABELS[card.source]}` : 'No Source tab open';
    }

    for (const control of [previous, playPause, next]) control.disabled = !card;
    const playing = !!card?.playing;
    playPause.textContent = playing ? '❚❚' : '▶';
    playPause.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    tick();
  }

  function tick() {
    const progress = card?.progress ? advance(card.progress, card.playing, Date.now() - receivedAt) : null;
    seekBar.disabled = !progress;
    if (seeking) return;
    seekBar.max = String(progress?.durationMs ?? 0);
    seekBar.value = String(progress?.positionMs ?? 0);
    position.textContent = clock(progress?.positionMs ?? 0);
    duration.textContent = clock(progress?.durationMs ?? 0);
  }

  return { element, update, tick };
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

const groups: ReturnType<typeof createPlayerGroup>[] = [];
watchPlayers(location.origin, (players) => {
  players.forEach((player, index) => {
    if (!groups[index]) {
      groups[index] = createPlayerGroup();
      container.append(groups[index].element);
    }
    groups[index].update(player);
  });
});
setInterval(() => {
  for (const group of groups) group.tick();
}, TICK_MS);
