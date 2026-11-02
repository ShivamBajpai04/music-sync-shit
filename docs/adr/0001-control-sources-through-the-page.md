# Control Sources through the web page, not service APIs

Players control Spotify Web and YouTube Music Web through a browser extension that runs in the Source tab: it drives the page's own controls, reads what's playing, and reports to a local agent on the Mac. We don't use the Spotify Web API because its playback-control endpoints require Premium and the account is free tier. Driving the page also gives both Sources a single control mechanism and keeps the user's logged-in Arc profile and adblock. The cost is fragility: when either service changes its page markup, the extension's selectors break.

## Considered Options

- **Spotify Web API / Spotify Connect**: needs Premium, and only covers Spotify.
- **AppleScript running JavaScript in the tab**: slower, can only poll, and needs "Allow JavaScript from Apple Events" turned on.
- **A Playwright-driven browser**: runs without the user's profile, login session and adblock.
