# The tailnet is the only trust boundary

The agents and the Remote web page are reachable only on my Tailscale tailnet and have no login or authentication of their own: any device on the tailnet can control any Player. This is a single-user tool, so building auth would cost more than it protects. The tailnet gives remote access from anywhere without exposing anything to the public internet. If another person or untrusted device ever joins the tailnet, revisit this decision.
