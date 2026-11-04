import { spawn } from 'node:child_process';

export interface VoiceOutput {
  write(data: Uint8Array): boolean;
  stop(): void;
  done: Promise<void>;
}

export function openVoiceOutput(binary: string): Promise<VoiceOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let ready = false;
    let stopped = false;
    let output = '';
    let errorOutput = '';
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const done = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    // Startup can fail before the caller has received the output object.
    void done.catch(() => {});
    const timer = setTimeout(() => { child.kill(); reject(new Error('The Mac audio output did not start.')); }, 5_000);
    child.stderr.on('data', data => { errorOutput = (errorOutput + String(data)).slice(-1000); });
    child.stdin.on('error', error => { if (!stopped) fail(error); });
    child.on('error', error => { clearTimeout(timer); reject(error); fail(error); });
    child.on('exit', code => {
      clearTimeout(timer);
      const error = new Error(errorOutput || 'The Mac voice output stopped unexpectedly.');
      if (!ready) reject(error);
      if (stopped || code === 0) finish();
      else fail(error);
    });
    child.stdout.on('data', data => {
      output += String(data);
      if (ready || !output.includes('READY\n')) return;
      ready = true;
      clearTimeout(timer);
      resolve({
        done,
        write(data) { return !stopped && child.stdin.write(data); },
        stop() {
          if (stopped) return;
          stopped = true;
          child.stdin.end();
          const kill = setTimeout(() => child.kill('SIGKILL'), 700);
          kill.unref();
          child.once('exit', () => clearTimeout(kill));
        },
      });
    });
  });
}
