# LinkedIn guest experimental source

This source uses LinkedIn's publicly reachable guest-search page as an unsupported page contract. It is an experiment, not an integration with LinkedIn.

It makes one transparent, bounded HTTPS request per configured search and is initially disabled. Haadar does not log in as Rafael, use a LinkedIn account, cookies, OAuth, browser session, proxy, CAPTCHA solver or identity-avoidance mechanism.

The three Brazil searches cover Java Junior, Node Junior and Full Stack Junior vacancies from the previous two hours. Each has a ten-second timeout, a 512 KiB response limit, one request and at most 25 records.

The searches are queued 180 seconds apart (0, 180 and 360 seconds) rather
than requested concurrently. This is ordinary rate reduction, not a bypass:
there is still no login, cookie, proxy, CAPTCHA solver or identity-avoidance
mechanism. A source that reaches three terminal failures is automatically
paused for six hours; a successful run clears its failure count.

If the guest endpoint is blocked or its markup changes for three consecutive active rounds, remove all three source definitions in a corrective commit and review the approach. It must never weaken or delay the other sources.
