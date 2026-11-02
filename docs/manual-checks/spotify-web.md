# Manual check: Spotify Web driver

The Source driver's page selectors aren't covered by automated tests. Run this checklist on a real Mac after changing the driver, or when Spotify changes its web player.

## Setup

1. `npm install && npm run build`
2. `npm run agent`, and note the Remote URL it prints.
3. In Arc, open `arc://extensions`, turn on Developer mode, choose **Load unpacked**, and select `dist/extension`. After a rebuild, click the extension's reload button instead.
4. Open https://open.spotify.com in Arc and start any track.
5. Open the Remote URL on another device on the tailnet, such as your phone.

## Checks

- [ ] **Read state**: the card shows "Online", Spotify Web, and the current track's title, artist and album art.
- [ ] **Live track change**: skip a track in Spotify itself. The card updates within about a second.
- [ ] **Live play/pause**: pause in Spotify itself. The card's button changes to ▶.
- [ ] **Play from Remote**: press ▶ on the card. Spotify starts playing.
- [ ] **Pause from Remote**: press ❚❚ on the card. Spotify pauses.
- [ ] **Next**: press ⏭ on the card. Spotify skips to the next track, and the card's track and progress bar reset.
- [ ] **Previous**: press ⏮ within the first few seconds of a track. Spotify goes back a track. Pressed later in a track, it restarts the track instead.
- [ ] **Progress**: the card's progress bar and times move along with Spotify's and stay within about a second of them.
- [ ] **Seek from Remote**: drag the card's progress bar to about the middle and let go. Spotify jumps there.
- [ ] **Seek in Spotify**: drag Spotify's own progress bar. The card follows within about two seconds.
- [ ] **Volume from Remote**: move the card's volume slider. The Mac's system volume changes, as shown by the menu bar volume indicator.
- [ ] **Volume on the Mac**: press the volume keys on the Mac. The card's slider follows within about two seconds.
- [ ] **Tab closed**: close the Spotify tab. The card shows "No Source tab open".
- [ ] **Agent restart**: stop and restart `npm run agent` with a Spotify tab open. The card recovers within about 30 seconds without reloading the tab.
- [ ] **Extension reload**: reload the extension in `arc://extensions`. The card recovers without reloading the Spotify tab.
