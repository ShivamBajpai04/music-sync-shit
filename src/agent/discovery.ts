import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { WebSocket } from 'ws';
import { DEFAULT_REMOTE_PORT, REMOTE_PATH, type PlayerEntry } from '../shared/protocol.ts';

export interface TailnetNode {
  address: string;
  aliases: string[];
  online: boolean;
}

function tailnetIPv4(address: unknown): address is string {
  if (typeof address !== 'string' || isIP(address) !== 4) return false;
  const octets = address.split('.').map(Number);
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

// Tailscale supplies candidates, not proof that a device runs Music Sync.
export function tailnetNodes(status: unknown): TailnetNode[] {
  const data = status as { Self?: unknown; Peer?: Record<string, unknown> };
  if (!data || typeof data !== 'object' || !data.Self || (data.Peer && typeof data.Peer !== 'object')) throw new Error('Invalid Tailscale status');
  return [data.Self, ...Object.values(data.Peer ?? {})].flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const node = value as { TailscaleIPs?: unknown[]; HostName?: string; DNSName?: string; Online?: boolean };
    const address = node.TailscaleIPs?.find(tailnetIPv4);
    if (!address) return [];
    const dns = typeof node.DNSName === 'string' ? node.DNSName.replace(/\.$/, '').toLowerCase() : '';
    return [{ address, online: node.Online !== false, aliases: [address, dns, dns.split('.')[0], node.HostName].filter((alias): alias is string => typeof alias === 'string' && !!alias).map(alias => alias.toLowerCase()) }];
  });
}

export async function readTailnetNodes(binary: string) {
  const { stdout } = await promisify(execFile)(binary, ['status', '--json'], { timeout: 5_000, maxBuffer: 4 * 1024 * 1024 });
  return tailnetNodes(JSON.parse(stdout));
}

// Read-only handshake works with existing agents; no peer upgrade or config
// endpoint is needed merely to discover one.
export function probePlayer(entry: PlayerEntry, timeoutMs: number, signal: AbortSignal) {
  return new Promise<boolean>(resolve => {
    const socket = new WebSocket(entry.url);
    let done = false;
    const finish = (found: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      else socket.close();
      resolve(found);
    };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
    socket.on('message', data => {
      try {
        const message = JSON.parse(String(data));
        finish(message.type === 'state' && typeof message.state?.name === 'string' && Array.isArray(message.state?.sources) && 'resume' in message.state && 'volume' in message.state);
      } catch { finish(false); }
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export function startPlayerDiscovery({ players, self, candidates, cachePath, ports = [DEFAULT_REMOTE_PORT, Number(new URL(self.url).port)], intervalMs = 15_000, probeTimeoutMs = 1_500, onError = console.error }: {
  players: PlayerEntry[];
  self: PlayerEntry;
  candidates: () => Promise<TailnetNode[]>;
  cachePath?: string;
  ports?: number[];
  intervalMs?: number;
  probeTimeoutMs?: number;
  onError?: (error: unknown) => void;
}) {
  const seeds = [...players];
  const learned = new Map<string, PlayerEntry>();
  const stopping = new AbortController();
  let inFlight: Promise<void> | null = null;
  let saved = '';
  let failed = false;
  const own = new URL(self.url);
  const label = (url: URL) => `${url.hostname}${url.port === String(DEFAULT_REMOTE_PORT) ? '' : `:${url.port}`}`;

  function publish(nodes: TailnetNode[] = []) {
    const aliases = new Map(nodes.flatMap(node => node.aliases.map(alias => [alias, node.address] as const)));
    const entries = new Map<string, PlayerEntry>();
    for (const entry of [self, ...seeds, ...learned.values()]) {
      const url = new URL(entry.url);
      const address = aliases.get(url.hostname.toLowerCase().replace(/\.$/, ''));
      if (address) url.hostname = address;
      const canonical = address ? { label: label(url), url: url.href } : entry;
      if (!entries.has(url.href)) entries.set(url.href, canonical);
    }
    players.splice(0, players.length, ...entries.values());
  }

  async function save() {
    if (!cachePath || stopping.signal.aborted) return;
    const value = JSON.stringify([...learned.values()]);
    if (value === saved) return;
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(`${cachePath}.tmp`, value + '\n', { mode: 0o600 });
    await rename(`${cachePath}.tmp`, cachePath);
    saved = value;
  }

  async function scan() {
    try {
      const nodes = await candidates();
      if (stopping.signal.aborted) return;
      const targets = new Map<string, PlayerEntry>();
      for (const node of nodes) {
        if (!node.online) continue;
        for (const port of new Set(ports)) {
          if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
          const url = new URL(`ws://${node.address}:${port}${REMOTE_PATH}`);
          if (url.href === own.href) continue;
          const entry = { label: label(url), url: url.href };
          targets.set(entry.url, entry);
        }
      }
      const pending = [...targets.values()];
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(6, pending.length) }, async () => {
        while (index < pending.length && !stopping.signal.aborted) {
          const entry = pending[index++];
          if (await probePlayer(entry, probeTimeoutMs, stopping.signal)) learned.set(entry.url, entry);
        }
      }));
      if (stopping.signal.aborted) return;
      publish(nodes);
      await save();
      failed = false;
    } catch (error) {
      // Preserve known Players if Tailscale temporarily disappears.
      if (!failed && !stopping.signal.aborted) onError(error);
      failed = true;
    }
  }

  function refresh() {
    if (stopping.signal.aborted) return Promise.resolve();
    if (!inFlight) inFlight = scan().finally(() => { inFlight = null; });
    return inFlight;
  }

  const ready = (async () => {
    if (cachePath) {
      try {
        const cached: unknown = JSON.parse(await readFile(cachePath, 'utf8'));
        if (!Array.isArray(cached)) throw new Error('Invalid discovered Players cache');
        for (const entry of cached) {
          try {
            const url = new URL(entry.url);
            if (url.protocol !== 'ws:' || !tailnetIPv4(url.hostname) || url.pathname !== REMOTE_PATH || !url.port || url.username || url.password || url.search || url.hash) continue;
            const normalized = { label: label(url), url: url.href };
            learned.set(url.href, normalized);
          } catch { /* Ignore malformed cache entries. */ }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') onError(error);
      }
    }
    if (stopping.signal.aborted) return;
    publish();
    await refresh();
  })();
  const timer = setInterval(() => { void ready.then(refresh); }, intervalMs);
  return {
    ready,
    refresh,
    async close() {
      clearInterval(timer);
      stopping.abort();
      await ready;
      await inFlight;
    },
  };
}
