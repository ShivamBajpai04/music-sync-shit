# Music Sync

A personal tool for controlling music playback on my Macs from any device on my tailnet, and moving playback between Macs.

## Language

**Player**:
A Mac where music actually plays, inside a browser tab running a Source. The phone is not a Player, because its YouTube Music app can't be controlled. Players play independently of each other, but one Spotify account can only be playing on one Player at a time.
_Avoid_: Device, host, speaker

**Remote**:
Any device on the tailnet used to issue commands to a Player. A phone is a Remote; a Mac can be both a Remote and a Player.
_Avoid_: Controller, client

**Source**:
A music service's web player that a Player plays through: Spotify Web or YouTube Music Web.
_Avoid_: Provider, app, service

**Handoff**:
Moving the current playback (Source, track, position, and Playback Context when known) from one Player to another, stopping it on the first.
_Avoid_: Sync, transfer, cast

**Playback Context**:
The playlist or album that the current track is being played from, so playback continues past it.
_Avoid_: Queue, collection

**Resume**:
Unpausing whatever is already loaded in a Player's Source tab.
_Avoid_: Continue, unpause

**Favourite**:
A saved Source link that the Remote can start with one tap. Planned as a follow-up to v1.
_Avoid_: Bookmark, preset

**Cross-Source Handoff**:
A Handoff where the target Player uses a different Source, so the track must be matched by title and artist. Deferred; needed if the phone ever becomes a Player.
_Avoid_: Conversion, translation

**Synchronized Playback**:
Two or more Players playing the same track at the same position simultaneously. Deferred; not part of v1.
_Avoid_: Sync, multi-room

**Tailnet**:
The set of my devices connected via Tailscale; the only network the tool is reachable on.
