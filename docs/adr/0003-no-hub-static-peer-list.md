# No hub: every agent serves the Remote, peers come from a static list

The static-list decision is superseded by [ADR-0004](0004-discover-players-on-the-tailnet.md). The no-hub architecture remains in effect.

Each Mac's agent has a config file listing both Macs by tailnet hostname, and any agent can serve the Remote page. The page connects to each listed agent directly. We chose this over a hub Mac or automatic discovery through Tailscale's local API so that no single Mac being asleep takes down control of the other. With two Macs, a hard-coded list is cheaper than discovery. Revisit this if more Players are added.
