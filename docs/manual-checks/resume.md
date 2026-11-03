# Manual check: Resume

Run this checklist after changing the last-playback memory, Resume, or either Source driver's track link reading.

## Setup

Same as [the Spotify Web checklist](./spotify-web.md#setup). Reload the extension, the Source tabs and the Remote page after building.

## Checks

- [ ] **Nothing remembered**: delete `~/.config/music-sync/last-playback.json`, then restart the agent with no Source tab open. The Mac's Resume button is greyed out.
- [ ] **Label**: play a Spotify track, then pause it. Resume reads "⟲ Resume “<track>” on Spotify Web". While it's playing, the button is greyed out.
- [ ] **Unpause a loaded tab**: with the track paused, press Resume. Spotify plays from where it was paused.
- [ ] **Reopen**: play a Spotify track to about the middle, then close the tab. Press Resume. Arc opens the track, it plays, and it jumps to about where it was.
- [ ] **Spotify playlist and album**: play a song from a playlist, close its tab, then Resume. The song starts near its saved position and continues in that playlist. Repeat from an album. Check the saved `context` in `~/.config/music-sync/last-playback.json` if the context does not carry over.
- [ ] **YouTube Music**: the same three checks with a YouTube Music song. Also try the YouTube Music check after browsing to another page while the song plays in the mini player.
- [ ] **YouTube Music playlist**: play a song from a playlist, close its tab, then Resume. The same song starts near its saved position with the playlist still in the page URL.
- [ ] **Restart**: with a track paused, stop and restart `npm run agent`. Resume still names the track, and pressing it plays from about where it was.
- [ ] **Follows the last Source played**: play Spotify, pause it, then play YouTube Music and pause it. Resume names the YouTube Music song.
- [ ] **Different loaded track**: pause a song, close its tab, then open the same Source on a different song without playing it. Resume restores the remembered song.
