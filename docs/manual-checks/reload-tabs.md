# Reload music tabs from the Remote

Build with `npm run build`, restart the agent, reload the unpacked extension
from `dist/extension`, and refresh the Remote.

1. Open Spotify and YouTube Music with a track loaded in each.
2. On the Spotify card, press **Reload tab**. Only Spotify should reload;
   its card should return after the content script reconnects.
3. Press **Reload tabs** in the Player header. All Spotify and YouTube Music
   tabs in the connected browser should reload, including duplicate tabs.
   Other websites should stay open without reloading.
4. Verify the header action is available when no Source card is shown. It
   should recover a matching tab even if its content-script port has gone away.
5. Disable the extension and press **Reload tabs**. The Remote should show
   that the extension is disconnected. Enable it and retry.

Reload bypasses the cache and may interrupt playback; it doesn't automatically
resume playback or reopen a closed tab. A fully hung browser or disconnected
extension still requires recovery on the Mac.
