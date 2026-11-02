import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// The OS side of a Player. Tests replace it with a fake.
export interface Mac {
  openInArc(url: string): Promise<void>;
}

export const realMac: Mac = {
  async openInArc(url) {
    await run('open', ['-a', 'Arc', url]);
  },
};
