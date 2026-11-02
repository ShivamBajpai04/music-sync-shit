# Manual check: two Players

Run this checklist after changing how the Remote finds and connects to Players.

## Setup

1. Make sure both Macs are signed in to Tailscale and show up in `tailscale status`. Note each Mac's name in the second column, such as `shivams-macbook-air`.
2. On each Mac, clone the repo and run `npm install && npm run build`, then load `dist/extension` unpacked in Arc (see [the Spotify Web checklist](./spotify-web.md#setup)).
3. On each Mac, create `~/.config/music-sync/config.json` with the same contents, listing both Macs:

   ```json
   { "players": ["shivams-macbook-air", "other-mac-name"] }
   ```

4. On each Mac, run `npm run agent`. It prints the Remote URL and both Players.
5. Open one Mac's Remote URL on your phone.

## Checks

- [ ] **Both Players**: the Remote shows a group for each Mac, each with its own name, "Online" status, volume bar and Source cards.
- [ ] **Either Mac serves it**: opening the other Mac's Remote URL shows the same two groups.
- [ ] **Separate control**: play/pause, next, previous and seek on one Mac's cards only affect that Mac.
- [ ] **Separate volume**: each Mac's volume bar only changes that Mac's system volume, and follows that Mac's volume keys.
- [ ] **One Mac down**: stop the agent on the Mac that *didn't* serve the page. Its group shows "Unavailable" and is dimmed, and the other Mac's group keeps working.
- [ ] **Recovery**: start that agent again. Its group comes back within a few seconds without reloading the page.
- [ ] **Asleep**: put the Mac that didn't serve the page to sleep. Its group shows "Unavailable", and it comes back after the Mac wakes and its agent reconnects.
