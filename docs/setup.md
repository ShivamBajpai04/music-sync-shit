# Set up a Mac as a Player

Follow this checklist on each Mac. You need a logged-in macOS user, Arc,
Node.js 24 or later, and Tailscale signed into the same tailnet as your Remote.
The agent runs in your user session; it becomes available after login, not
before login, and a sleeping Mac remains unavailable.

## Install and configure

- [ ] Check `node --version`, `npm --version`, `tailscale version`, and
  `tailscale ip -4`. The Tailscale CLI must be on your Terminal's PATH.
  For the Mac App Store version, enable/install its CLI using Tailscale's
  instructions if `tailscale` is missing.
- [ ] Enable Tailscale's option to launch/connect at login. If Tailscale isn't
  ready yet when the agent starts, launchd retries the agent until it is ready.
- [ ] Clone the repo and build it:

  ```sh
  git clone https://github.com/ShivamBajpai04/music-sync-shit.git
  cd music-sync-shit
  npm ci
  npm run build
  ```

- [ ] Player discovery is automatic. Each Mac must run the agent and be on
  the same tailnet. There is no need to copy a Player list between Macs.
  Config at `~/.config/music-sync/config.json` is optional; `{}` works.
  To set a friendly name for this Player, for example:

  ```json
  { "name": "Bedroom Mac" }
  ```

  Installation creates the config directory and an empty config if needed.
  Other optional fields are `port` (default 4848) and `host` (this Mac's
  tailnet IPv4 address). Normally omit `host`; the agent reads it from
  Tailscale. Keep the listen address on the tailnet.
- [ ] Stop any manually running `npm run agent` with Ctrl+C.
- [ ] Run `npm run service:install`, then `npm run service:status`. Look for
  `state = running` and a PID. The installer uses launchd to start the agent
  now and at subsequent logins, and restart it after exits or crashes.

The installer copies the bundled agent, Remote, and extension to
`~/Library/Application Support/Music Sync`. The login job is
`~/Library/LaunchAgents/com.music-sync.agent.plist`. It records the absolute
paths of the Node and Tailscale executables found during installation; it
doesn't need an interactive shell, npm, or this checkout to run. Keep that Node
version installed, or rerun installation after changing Node versions.

## Prepare Arc

- [ ] Open `arc://extensions`, enable **Developer mode**, choose **Load
  unpacked**, and select `~/Library/Application Support/Music Sync/extension`.
  In the folder picker, Cmd+Shift+G lets you paste that path. Load Music Sync
  once; remove an older copy if it was loaded from `dist/extension`.
- [ ] Sign in to Spotify Web and YouTube Music Web in Arc.
- [ ] Pin both Source tabs in Arc (tab menu → **Pin Tab**) so Arc won't archive
  them as ordinary Today tabs. Start a track once in each Source.
- [ ] In each site's settings, set **Sound** to **Allow** for
  `https://open.spotify.com` and `https://music.youtube.com`. In Arc/Chromium
  Settings, search for Sound, then add the sites to the allowed list if needed.
  Verify that a link started from the Remote can begin audio without clicking
  inside the Source tab. Sound permission and autoplay behavior can differ;
  use [the link-start checklist](manual-checks/start-link.md#autoplay-from-6)
  if this check fails.

## Check the Player

- [ ] Read the Remote URL from `~/Library/Logs/Music Sync/agent.log`, then open
  it on a phone or Mac on the same tailnet. The default is
  `http://<this-mac-tailnet-ip>:4848/`.
- [ ] Check track information, play/pause, seek, system volume, and starting a
  pasted link. When both Macs are set up, both Player cards should appear
  automatically within about 20 seconds, even if the Remote was already open.
- [ ] Run `npm run service:restart`. The Remote should reconnect and the Source
  cards should return without reloading the extension.
- [ ] To check crash recovery, note the PID in `npm run service:status`, run
  `kill -KILL <that-pid>`, and check status again after about 10 seconds. A new
  PID should appear and the Remote should reconnect.
- [ ] Log out and back in when convenient. Check the Remote before opening a
  Terminal; it should become available once Tailscale is ready. Arc may need to
  reopen its pinned tabs before Source cards appear. Starting a link can launch
  Arc if it isn't running.

## Update

From the checkout:

```sh
git pull --ff-only
npm ci
npm run build
npm run service:install
```

Then open `arc://extensions` and click Music Sync's **Reload** button. Refresh
the Remote page. Rebuild and reinstall **before** reloading the unpacked
extension, since Arc loads the installed copy. Updates keep config and last
playback memory. The service restart briefly disconnects the Remote but
doesn't close the Source tabs.

## Manage and troubleshoot

Discovery checks Tailscale peers every 15 seconds, verifies Music Sync on port
4848 (and this Mac's configured port), and caches known Players in
`~/.config/music-sync/discovered-players.json`. It doesn't add phones or other
tailnet devices unless they actually respond as Music Sync agents. Known
offline Players stay visible as unavailable. The Remote refreshes the directory
every 5 seconds without dropping existing Player connections; refresh the page
once after upgrading from a version that used static lists.

Existing `players` entries remain optional seeds. For a peer using another
custom port, add `"players": ["peer-name:5000"]`. For a fully manual list, set
`"discoverPlayers": false` and configure `players` yourself. Automatic discovery
otherwise works even if the two Macs have different or empty seed lists. Check
the error log if Tailscale's CLI isn't available; known Players remain usable
while discovery retries. To forget old automatically discovered Players, stop
the service, remove its discovered-players cache, and reinstall; reachable
Players will be discovered again.

```sh
npm run service:status
npm run service:restart
npm run service:uninstall
```

Uninstall stops the agent and removes its login plist. It keeps installed files,
config, playback memory, and logs; remove the unpacked extension in Arc separately
if you no longer want it.

Logs are `~/Library/Logs/Music Sync/agent.log` and `agent-error.log`. If the
agent keeps restarting, check that Tailscale is connected and the recorded Node
and Tailscale executables still exist. If an address is already in use, stop a
manual agent before installing. If macOS blocks the background item, allow Music
Sync/Node under System Settings → General → Login Items & Extensions, then
reinstall. An offline Player or a Mac waiting for login can't be recovered from
the Remote.

The launchd behavior follows Apple's [Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html): a user LaunchAgent with RunAtLoad and KeepAlive, managed with launchctl.

Candidate discovery uses the documented machine-readable [`tailscale status --json`](https://tailscale.com/docs/reference/tailscale-cli) output.

## Android push-to-talk

Build and reinstall the agent on each receiving Mac (`npm run build` then
`npm run service:install`). The native voice helper needs Apple's command-line
tools; if `xcrun swiftc` is missing, install them with `xcode-select --install`.
Build on each Mac so the helper matches its processor. No extension reload is
needed for voice, and no music tab needs to be open.

On the Mac whose Remote link you use on Android, run `npm run voice:setup`.
It adds a private Tailscale HTTPS route on port 8443 and prints the new link.
If Tailscale asks you to enable HTTPS, follow its approval link and rerun the
command. Existing routes on port 443 are preserved; a conflicting 8443 route
causes setup to stop. This uses Serve, never Funnel.

Open that HTTPS link in Android Chrome with Tailscale connected. Hold the talk
button under the intended Mac and allow microphone access. After granting it,
release and hold again if necessary. The button lights up when transmission
actually starts. Releasing, cancelling the touch, switching apps, or losing
the connection stops capture. Each hold has a 60-second limit. There are no
recordings; your voice uses the destination Mac's current output and volume.
If another Remote is already talking to that Mac, wait until it releases.

HTTPS Remote controls and voice both pass through the Mac serving the page;
keep that Mac awake. You can run setup on both Macs for alternate HTTPS links.
The original HTTP links still control music but cannot use Android's microphone.
