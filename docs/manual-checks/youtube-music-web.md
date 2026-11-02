# Manual check: YouTube Music Web driver

The Source driver's page selectors aren't covered by automated tests. Run this checklist on a real Mac after changing the driver, or when YouTube Music changes its web player.

## Setup

Same as [the Spotify Web checklist](./spotify-web.md#setup), but open https://music.youtube.com in Arc and start any track. After loading a new build, reload the extension in `arc://extensions`.

## Checks

- [ ] **Read state**: the card shows "Online", YouTube Music Web, and the current track's title, artist (without album or year) and art.
- [ ] **Live track change**: skip a track in YouTube Music itself. The card updates within about a second.
- [ ] **Live play/pause**: pause in YouTube Music itself. The card's button changes to ▶.
- [ ] **Play / pause from Remote**: ▶ and ❚❚ on the card control YouTube Music.
- [ ] **Next / previous**: ⏭ skips forward. ⏮ goes back, or restarts the track once it's under way.
- [ ] **Progress**: the card's progress bar and times stay within about a second of YouTube Music's.
- [ ] **Seek from Remote**: drag the card's progress bar and let go. YouTube Music jumps there, and its own progress bar follows.
- [ ] **Seek in YouTube Music**: drag YouTube Music's own progress bar. The card follows within about two seconds.
- [ ] **Tab closed**: close the tab. The card shows "No Source tab open".

## With both Source tabs open

- [ ] With a track loaded in both, the Player shows two cards, Spotify first and then YouTube Music, whether each is playing or paused.
- [ ] Pausing one while both play keeps its card, and ▶ on that card starts it again.
- [ ] Each card's play/pause, next, previous and seek control only its own Source. Volume moves together on both cards.
- [ ] A Source tab with nothing loaded (such as the YouTube Music home page) has no card while the other Source has a track.
- [ ] Closing a Source tab removes its card.
