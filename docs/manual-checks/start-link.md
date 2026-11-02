# Manual check: starting a link

Run this checklist after changing how links are started, or either Source driver's start-on-load code.

## Setup

Same as [the Spotify Web checklist](./spotify-web.md#setup). Reload the extension and the Remote page after building. Have a few links ready: a Spotify track, album and playlist, and a YouTube Music song, playlist and album. The Spotify and YouTube Music apps' "Share → Copy link" both work.

## Checks

### Reusing a tab

- [ ] **Spotify track**: with a Spotify tab open, paste a Spotify track link into the Mac's link field and press Play. The tab goes to the track and starts playing it.
- [ ] **Spotify album and playlist**: the same for an album link and a playlist link. Playback starts from the first track.
- [ ] **YouTube Music song**: with a YouTube Music tab open, paste a song link. The tab goes to it and plays.
- [ ] **YouTube Music playlist and album**: the same for a playlist and an album link.
- [ ] **No "Leave site?" dialog**: paste a link while a song is playing in each Source. The tab navigates without asking. (Known to fail on YouTube Music; see the follow-up issue.)
- [ ] **Same page again**: paste a link to what's already open in the tab. It starts playing without a reload.

### Opening a tab or Arc

- [ ] **No tab**: close the Spotify tab, then paste a Spotify link. Arc opens a new tab on it, and it plays.
- [ ] **Arc not running**: quit Arc (⌘Q), then paste a link. Arc launches, opens the link, and it plays.

### Autoplay (from #6)

- [ ] With **Sound** set to **Allow** for open.spotify.com and music.youtube.com in Arc's site settings, a link opened in a **new** tab, with nobody clicking on the Mac, starts playing. Write down the result in the PR either way. If it doesn't play, the fallback is launching Arc with Chrome's `--autoplay-policy=no-user-gesture-required` flag.

### The other Source and errors

- [ ] **Other Source playing**: with Spotify playing, paste a YouTube Music link. Spotify pauses and keeps its card, and YouTube Music plays.
- [ ] **Unsupported link**: paste `https://example.com`. The Mac's group shows "Not a Spotify or YouTube Music link", and nothing opens. The error goes away on the next action.
- [ ] **Other Remotes**: an error shows only on the Remote that pasted the link, not on another open Remote.
