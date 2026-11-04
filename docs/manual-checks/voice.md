# Voice Channel

- Update both Mac agents. Set up private HTTPS on the serving Mac. Open the printed link on Android Chrome with Tailscale connected.
- Allow microphone access, hold the Pro's talk button and speak. Only the Pro should play the voice, even with no music tab open. Repeat for the Air.
- Release, cancel a touch, switch apps, or close the page. Audio and Android's microphone indicator should stop. Release while the permission prompt is open, then grant permission: capture must stop without transmitting.
- Try a second Remote while a Mac is receiving: it should report that the channel is busy. Holding the other Mac should still work.
- Disconnect Tailscale or sleep a target Mac. Verify a useful error and that capture stops; reconnect and try again.
- Verify music volume, play/pause, reload tabs and Handoff through the HTTPS link. Verify the old HTTP link still works, shows a secure link, and disables microphone capture.
- Check that a 60-second hold stops, and another hold can start a fresh channel. Check headphones or another current Mac audio output.
