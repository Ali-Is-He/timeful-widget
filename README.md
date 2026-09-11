# Timeful Widget

A [Scriptable](https://scriptable.app/) iOS widget that shows the best overlapping availability from a [timeful.app](https://timeful.app) scheduling event, right on your home screen.

## Files

- `timeful-widget.js` — the widget. Fetches an event's responses, finds the best overlapping time windows, and renders a small (best time today) or medium/large (heatmap grid) widget.
- `timeful-log-viewer.js` — a companion script to view the widget's debug log (`timeful-log.txt`) via QuickLook.

## Setup

1. Install [Scriptable](https://apps.apple.com/app/scriptable/id1405459188) on iOS.
2. Add both `.js` files as new scripts in the Scriptable app.
3. Run `timeful-widget.js` once manually — you'll be prompted to paste your timeful event link (e.g. `https://timeful.app/e/abc123`) or just the code after `/e/`. This is saved to the Keychain as the default event.
4. Add a Scriptable widget to your home screen, set it to run `timeful-widget.js`. Optionally pass a different event link as the widget's parameter to override the saved default.

## Behavior

- **Small widget**: shows the best overlapping time window today (headcount, time range, names) plus a runner-up.
- **Medium/large widget**: draws a heatmap grid of the next 7 days by hour, shaded by how many people are available.
- Falls back to the last successfully fetched data (marked "offline") if a network request fails.
- Refreshes automatically every 15 minutes.

## Debugging

Run `timeful-log-viewer.js` to view the rolling debug log written by the widget (last ~8000 characters).
