import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// The OS side of a Player. Tests replace it with a fake.
export interface Mac {
  openInArc(url: string): Promise<void>;
  // System output volume, 0-100.
  getVolume(): Promise<number>;
  setVolume(volume: number): Promise<void>;
}

export const realMac: Mac = {
  async openInArc(url) {
    await run('open', ['-a', 'Arc', url]);
  },
  async getVolume() {
    const { stdout } = await run('osascript', ['-e', 'output volume of (get volume settings)']);
    return Number(stdout.trim());
  },
  async setVolume(volume) {
    await run('osascript', ['-e', `set volume output volume ${Math.round(volume)}`]);
  },
};
