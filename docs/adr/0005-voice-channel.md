# Stream push-to-talk audio to the selected Mac agent

Voice Channels use mono 24 kHz PCM over WebSockets, with short bounded packets and no recordings. A native AVAudioEngine helper plays the stream on the selected Mac's current output; no Source tab or extension audio permission is required. One sender can occupy a Player's channel at a time, with idle and 60-second limits.

Android microphone capture requires a secure context. Tailscale Serve provides private HTTPS on port 8443, forwarding to an additional loopback listener. HTTPS Remotes use same-origin WebSocket relays for both voice and music controls, restricted to the serving agent's configured/discovered Players. This changes ADR-0003's direct-connection behavior for HTTPS Remotes: their connections depend on the serving agent. HTTP Remotes retain direct control connections. ADR-0002's tailnet trust model remains in place; Serve must never use Funnel.

The Remote captures only during an intentional hold, closes capture on release/cancel/background/disconnection, and discards microphone access that resolves after release. PCM trades bandwidth (~48 KB/s) for a small native receiver without WebRTC signaling, ICE, browser autoplay requirements, or external infrastructure.
