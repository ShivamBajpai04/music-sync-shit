# Manual check: Handoff

Requires two real Macs. Install the updated agent and extension on both using
[the setup checklist](../setup.md). Leave discovery enabled on both Macs, or
configure both Player lists manually if discovery is disabled. Open the Remote from either Mac and confirm both
Players are online.

- [ ] Play a Spotify track from a playlist on the first Player and seek to the
  middle. Press **Move to [other Mac]** on its Source card. The other Player
  starts the same track near the sent position, with the same playlist; the
  original pauses. Spotify may pause the original automatically.
- [ ] Repeat with a Spotify album. Skip on the target to confirm its Playback
  Context continues beyond the handed-off track.
- [ ] Repeat with a YouTube Music track whose URL includes a list ID. Confirm
  the list is retained and the target plays before the original pauses.
- [ ] Repeat with a track that has no Playback Context available. The same
  track should still move.
- [ ] Start the target's other Source first, then Handoff onto it. The other
  Source pauses and keeps its tab/card; the handed-off Source starts.
- [ ] Close the target's Source tab, then Handoff again. Arc should open the
  Source and start it without manual preparation.
- [ ] Take the peer offline. **Move to** should remain visible but disabled.
- [ ] Make the target fail to load/play the requested item. After the timeout,
  the Remote reports the failure and the known playback state on each Player.
  The original is not deliberately paused before target confirmation. Spotify
  may independently pause it under its account session rule.
- [ ] Interrupt the target agent during Handoff. Its playback is reported as
  unknown instead of being assumed stopped. A late browser start may still
  occur after a network failure; inspect both cards once they reconnect.

Handoff stays on the same Source. It waits up to 25 seconds for the requested
track and position (within two seconds) to be reported on the target, and for
the target's other Source to report paused. It then pauses the original and
waits for that confirmation. Errors describe the latest confirmed states;
disconnected Source tabs or Players are explicitly unknown.

These checks have automated equivalents with two real agents and fake Source
tabs in `test/handoff.test.ts`. They do not replace validation against the live
Source pages on two Macs.
