import { SOURCE_LABELS, advance, type RemoteToAgent, type SourceCommand, type SourceId, type SourceState } from '../shared/protocol.ts';
import { watchPlayers, type PlayerConnection } from './players.ts';
import { installGlass } from './glass.ts';

const TICK_MS = 250;
const container = document.getElementById('players')!;

// One group per Player: its name, status and the Mac's volume, then a card
// per Source the agent lists.
function createPlayerGroup() {
  let player: PlayerConnection | null = null;
  // While the slider is held, incoming state doesn't move it.
  let adjustingVolume = false;

  const element = el('section', '', 'player');
  installGlass(element);
  const name = el('h2', 'Player');
  const status = el('span', '', 'status');
  const header = el('header');
  const reloadAll = button('Reload tabs', 'Reload all music tabs', () => player?.send({ type: 'reload-tabs' }));
  reloadAll.className = 'reload-tabs';
  reloadAll.title = 'Reload Spotify and YouTube Music tabs if they stop responding';
  const actions = el('div', '', 'player-actions');
  actions.append(reloadAll, status);
  header.append(name, actions);

  const volume = slider('Volume');
  volume.max = '100';
  volume.addEventListener('input', () => (adjustingVolume = true));
  volume.addEventListener('change', () => {
    adjustingVolume = false;
    player?.send({ type: 'set-volume', volume: Number(volume.value) });
  });
  const volumeRow = el('label', '', 'volume');
  volumeRow.append(icon('volumeLow'), volume, icon('volumeHigh'));

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

  const resume = button('', 'Resume', () => player?.send({ type: 'resume' }));
  resume.className = 'resume';

  const cardList = el('div', '', 'cards');
  element.append(header, volumeRow, linkForm, error, resume, cardList);
  const cards = new Map<SourceId | 'none', ReturnType<typeof createCard>>();

  function update(next: PlayerConnection) {
    player = next;
    const { online, state } = player;
    name.textContent = state?.name ?? player.label;
    status.textContent = online ? 'Online' : 'Unavailable';
    status.className = `status ${online ? 'online' : 'offline'}`;
    element.classList.toggle('offline', !online);

    link.disabled = start.disabled = !online;
    reloadAll.disabled = !online;
    const resumable = online ? state!.resume : null;
    resume.disabled = !resumable;
    resume.textContent = resumable ? `⟲ Resume “${resumable.track.title}” on ${SOURCE_LABELS[resumable.source]}` : '⟲ Resume';
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
  const reload = button('Reload tab', 'Reload music tab', () => {
    if (card) send({ type: 'reload-tabs', source: card.source });
  });
  reload.className = 'reload-tabs reload-source';
  now.append(art, meta, empty, reload);

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

  const previous = button('', 'Previous', () => command({ type: 'previous' }));
  previous.append(icon('previous'));
  const playPause = button('', 'Play', () => command({ type: card?.playing ? 'pause' : 'play' }));
  playPause.append(icon('play'));
  playPause.classList.add('play-pause');
  const next = button('', 'Next', () => command({ type: 'next' }));
  next.append(icon('next'));
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
    reload.hidden = !card;
    reload.disabled = !online;
    reload.setAttribute('aria-label', card ? `Reload ${SOURCE_LABELS[card.source]} tab` : 'Reload music tab');
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
    playPause.replaceChildren(icon(playing ? 'pause' : 'play'));
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

function icon(name: 'volumeLow' | 'volumeHigh' | 'previous' | 'play' | 'pause' | 'next') {
  const paths = {
    volumeLow: '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16 9a4 4 0 0 1 0 6"/>',
    volumeHigh: '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M19 6a8 8 0 0 1 0 12"/>',
    previous: '<path d="M5 6v12M18 6 8 12l10 6V6Z"/>',
    play: '<path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
    next: '<path d="M19 6v12M6 6l10 6-10 6V6Z"/>',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths[name];
  return svg;
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
