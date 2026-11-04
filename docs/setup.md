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

- [ ] Create `~/.config/music-sync/config.json`. For two Players, put both
  Macs' Tailscale DNS names in the same list on each Mac:

  ```json
  { "players": ["office-mac", "bedroom-mac"] }
  ```

  Replace those example names with the names in your Tailscale device list.
  Create the directory with `mkdir -p ~/.config/music-sync` first. If you skip
  this step, installation creates `{}` and the Remote shows only this Mac.
  Optional fields are `name` (this Player's display name), `port` (default
  4848), and `host` (this Mac's tailnet IPv4 address). Normally omit `host`;
  the agent reads it from Tailscale. A Player entry can be `hostname:port`.
  Keep the listen address on the tailnet.
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
  pasted link. When both Macs are set up, confirm that both Player cards appear.
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
