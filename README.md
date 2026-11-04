# Music Sync

Control Spotify Web and YouTube Music Web on your Macs from a Remote on your
Tailscale tailnet. Each Player runs a local agent and an unpacked Arc extension.

Follow the [Mac setup checklist](docs/setup.md) to install the login agent,
configure Players, and prepare Arc. It also covers updates and troubleshooting.

For Android push-to-talk, update the agent on both Macs, then run
`npm run voice:setup` on the Mac serving your Remote. Open the private HTTPS
link it prints, allow microphone access, and hold **Hold to talk** under the
Mac you want to address. Voice plays through that Mac's current audio output.

For development, use Node.js 24 or later:

```sh
npm ci
npm run build
npm run agent
```

Stop the installed login agent with `npm run service:uninstall` before running
a development agent on the same ports. Run checks with `npm test` and
`npm run typecheck`. Manual Source checks are in [docs/manual-checks](docs/manual-checks).
