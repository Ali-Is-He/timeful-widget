// Variables used by Scriptable.
// icon-color: blue; icon-glyph: calendar-alt;

const fm = FileManager.local()
const KEYCHAIN_KEY = "timeful-default-event"
const LOG_PATH = fm.joinPath(fm.documentsDirectory(), "timeful-log.txt")

function log(msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`
    const existing = fm.fileExists(LOG_PATH) ? fm.readString(LOG_PATH) : ""
    fm.writeString(LOG_PATH, (existing + line).slice(-8000))
  } catch (e) {}
}

async function run() {
  log(`run start | runsInWidget=${config.runsInWidget} family=${config.widgetFamily} hasParam=${!!args.widgetParameter}`)

  let input = args.widgetParameter
  if (!input && Keychain.contains(KEYCHAIN_KEY)) input = Keychain.get(KEYCHAIN_KEY)
  log(`resolved input=${input ? "yes" : "no"}`)

  if (!input) {
    if (config.runsInWidget) {
      await presentWidget(errorWidget("No event set.\nOpen this script in Scriptable once to save a default, or set the event link as this widget's parameter."))
      return
    }
    try {
      input = await promptForEventCode()
    } catch (e) {
      await presentWidget(errorWidget(e.message))
      return
    }
  }

  let data
  let stale = false
  try {
    data = await fetchAndParse(input)
    saveCache(input, data)
    log(`fetch ok | slots=${data.slots.length} totalPeople=${data.totalPeople}`)
  } catch (e) {
    log(`fetch failed: ${e.message}`)
    data = loadCache(input)
    if (!data) {
      await presentWidget(errorWidget(`Couldn't load timeful:\n${e.message}`))
      return
    }
    stale = true
  }
  data.stale = stale

  let widget
  try {
    widget = buildWidget(data)
    log("build ok")
  } catch (e) {
    log(`build failed: ${e.message}\n${e.stack || ""}`)
    widget = errorWidget(`Render error:\n${e.message}`)
  }
  await presentWidget(widget)
  log("presented")
}

async function promptForEventCode() {
  const alert = new Alert()
  alert.title = "Timeful Widget"
  alert.message = "Paste your timeful event link (or just the code after '/e/')"
  alert.addTextField("https://timeful.app/e/...")
  alert.addAction("Save")
  alert.addCancelAction("Cancel")
  const idx = await alert.present()
  const value = alert.textFieldValue(0)
  if (idx === -1 || !value) throw new Error("No event configured")

  Keychain.set(KEYCHAIN_KEY, value.trim())
  return value.trim()
}

function extractShortId(input) {
  const match = input.match(/\/e\/([A-Za-z0-9_-]+)/)
  if (match) return match[1]
  return input.replace(/^\/?e\//, "").trim()
}

async function fetchAndParse(input) {
  const shortId = extractShortId(input)
  const eventUrl = `https://timeful.app/api/events/${shortId}`

  const event = await new Request(eventUrl).loadJSON()
  if (event.error) throw new Error(event.error)

  const dayTimes = (event.dates || []).map(d => new Date(d).getTime()).filter(Number.isFinite)
  const timeMin = new Date((dayTimes.length ? Math.min(...dayTimes) : Date.now()) - 86400000).toISOString()
  const timeMax = new Date((dayTimes.length ? Math.max(...dayTimes) : Date.now()) + 2 * 86400000).toISOString()

  const responsesUrl = `https://timeful.app/api/events/${shortId}/responses?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`
  const responses = await new Request(responsesUrl).loadJSON()

  const counts = {}
  const namesBySlot = {}
  for (const key of Object.keys(responses)) {
    const r = responses[key]
    for (const iso of r.availability || []) {
      counts[iso] = (counts[iso] || 0) + 1
      if (!namesBySlot[iso]) namesBySlot[iso] = []
      namesBySlot[iso].push(r.name || key)
    }
  }

  const slots = Object.keys(counts).map(iso => ({
    time: Math.floor(new Date(iso).getTime() / 1000),
    count: counts[iso],
    people: namesBySlot[iso]
  }))

  return {
    title: event.name || "Timeful",
    totalPeople: typeof event.numResponses === "number" ? event.numResponses : Object.keys(responses).length,
    slots,
    timeIncrement: (event.timeIncrement || 30) * 60,
    url: `https://timeful.app/e/${shortId}`,
    fetchedAt: Date.now()
  }
}

function cachePathFor(input) {
  const key = input.replace(/[^a-zA-Z0-9]/g, "_")
  return fm.joinPath(fm.documentsDirectory(), `timeful-cache-${key}.json`)
}

function saveCache(input, data) {
  try {
    fm.writeString(cachePathFor(input), JSON.stringify(data))
  } catch (e) {}
}

function loadCache(input) {
  try {
    const p = cachePathFor(input)
    if (!fm.fileExists(p)) return null
    return JSON.parse(fm.readString(p))
  } catch (e) {
    return null
  }
}

// Always returns exactly 7 entries — today through +6 days — regardless of
// whether anyone has marked availability on a given day, so the grid never
// silently drops days nobody happened to respond to.
function buildGrid(slots) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const days = []
  for (let i = 0; i < 7; i++) {
    days.push({ date: new Date(today.getTime() + i * 86400000), slots: [] })
  }

  for (const s of slots) {
    const d = new Date(s.time * 1000)
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const idx = Math.round((dayStart - today.getTime()) / 86400000)
    if (idx >= 0 && idx < 7) days[idx].slots.push(s)
  }

  return days
}

function hourBuckets(day) {
  const buckets = {}
  for (const s of day.slots) {
    const h = new Date(s.time * 1000).getHours()
    if (!buckets[h]) buckets[h] = []
    buckets[h].push(s.count)
  }
  return buckets
}

function hourRange(windowed) {
  let minH = 23, maxH = 0, any = false
  for (const day of windowed) {
    for (const s of day.slots) {
      const h = new Date(s.time * 1000).getHours()
      any = true
      if (h < minH) minH = h
      if (h > maxH) maxH = h
    }
  }
  if (!any) return [9, 20]
  return [Math.max(0, minH - 1), Math.min(23, maxH + 1)]
}

function formatHour(h) {
  const period = h < 12 ? "a" : "p"
  let hh = h % 12
  if (hh === 0) hh = 12
  return `${hh}${period}`
}

function formatTime(date) {
  const m = date.getMinutes()
  if (m === 0) return formatHour(date.getHours())
  const h = date.getHours()
  const period = h < 12 ? "a" : "p"
  let hh = h % 12
  if (hh === 0) hh = 12
  return `${hh}:${String(m).padStart(2, "0")}${period}`
}

function heatColor(ratio) {
  if (ratio <= 0) return Color.dynamic(new Color("#e5e5ea"), new Color("#3a3a3c"))
  const alpha = 0.28 + ratio * 0.72
  return new Color("#34c759", alpha)
}

function widgetSize(family) {
  // Used as a drawing canvas only — the image is applied as a stretched
  // backgroundImage, so it fills the widget's real on-device bounds
  // regardless of how close these approximate point sizes are.
  const sizes = {
    small: new Size(155, 155),
    medium: new Size(329, 155),
    large: new Size(329, 345)
  }
  return sizes[family] || sizes.medium
}

function drawFullWidget(data, family, windowed) {
  const size = widgetSize(family)
  const ctx = new DrawContext()
  ctx.size = size
  ctx.respectScreenScale = true
  ctx.opaque = false

  const textColor = Color.dynamic(Color.black(), Color.white())
  const pad = 10
  const titleH = 16
  const footerH = 12
  const dayHeaderH = 14
  const labelW = 20

  let y = pad
  ctx.setFont(Font.boldSystemFont(13))
  ctx.setTextColor(textColor)
  ctx.drawTextInRect(data.title || "Timeful", new Rect(pad, y, size.width - pad * 2, titleH))
  y += titleH + 2

  const gridTop = y + dayHeaderH
  const gridBottom = size.height - pad - footerH
  const gridLeft = pad + labelW
  const gridRight = size.width - pad

  const [minH, maxH] = hourRange(windowed)
  const numDays = windowed.length
  const numHours = maxH - minH + 1
  const cellW = (gridRight - gridLeft) / numDays
  const cellH = (gridBottom - gridTop) / numHours

  ctx.setFont(Font.systemFont(9))
  ctx.setTextColor(Color.gray())
  windowed.forEach((day, i) => {
    const label = day.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })
    ctx.drawTextInRect(label, new Rect(gridLeft + i * cellW, y, cellW, dayHeaderH))
  })

  const showCounts = cellW >= 26 && cellH >= 15

  for (let h = minH; h <= maxH; h++) {
    const row = h - minH
    const rowY = gridTop + row * cellH

    ctx.setFont(Font.systemFont(8))
    ctx.setTextColor(Color.gray())
    ctx.drawTextInRect(formatHour(h), new Rect(pad, rowY + cellH / 2 - 5, labelW - 2, 10))

    windowed.forEach((day, i) => {
      const counts = hourBuckets(day)[h] || []
      const count = counts.length ? Math.max(...counts) : 0
      const ratio = data.totalPeople > 0 ? count / data.totalPeople : 0
      const rect = new Rect(gridLeft + i * cellW + 1, rowY + 1, cellW - 2, cellH - 2)
      const path = new Path()
      path.addRoundedRect(rect, 3, 3)
      ctx.addPath(path)
      ctx.setFillColor(heatColor(ratio))
      ctx.fillPath()

      if (showCounts && count > 0) {
        ctx.setFont(Font.boldSystemFont(9))
        ctx.setTextColor(ratio > 0.55 ? Color.white() : textColor)
        ctx.drawTextInRect(`${count}`, new Rect(rect.x, rect.y + rect.height / 2 - 6, rect.width, 12))
      }
    })
  }

  ctx.setFont(Font.systemFont(9))
  ctx.setTextColor(Color.gray())
  const footerText = `${data.totalPeople} ${data.totalPeople === 1 ? "person" : "people"} · updated ${timeAgo(data.fetchedAt)}${data.stale ? " · offline" : ""}`
  ctx.drawTextInRect(footerText, new Rect(pad, size.height - pad - footerH, size.width - pad * 2, footerH))

  return ctx.getImage()
}

function timeAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  return `${Math.round(mins / 60)}h ago`
}

// Splits the day into maximal runs of consecutive slots that all share the
// exact same headcount — each run is one candidate "window."
function segmentDaySlots(daySlots, incrementSeconds) {
  const sorted = [...daySlots].sort((a, b) => a.time - b.time)
  const segments = []
  let current = []
  for (const s of sorted) {
    const prev = current[current.length - 1]
    const contiguous = prev && s.time - prev.time === incrementSeconds && s.count === prev.count
    if (contiguous) {
      current.push(s)
    } else {
      if (current.length) segments.push(current)
      current = [s]
    }
  }
  if (current.length) segments.push(current)
  return segments
}

function windowFromSegment(segment, incrementSeconds) {
  const durationSeconds = segment.length * incrementSeconds
  const count = segment[0].count

  let peopleSet = null
  for (const s of segment) {
    const set = new Set(s.people || [])
    peopleSet = peopleSet ? new Set([...peopleSet].filter(p => set.has(p))) : set
  }

  return {
    count,
    start: new Date(segment[0].time * 1000),
    end: new Date(segment[segment.length - 1].time * 1000 + incrementSeconds * 1000),
    durationSeconds,
    score: count * durationSeconds,
    people: [...(peopleSet || [])]
  }
}

// Ranks windows by "most people for the most time" (count × duration), not
// just raw headcount — a 2-hour block with 2 people can outrank a 15-minute
// block that also has 2 people. Ties broken by longer duration, then earlier.
function rankWindowsForDay(daySlots, incrementSeconds) {
  const windows = segmentDaySlots(daySlots, incrementSeconds)
    .map(seg => windowFromSegment(seg, incrementSeconds))
    .filter(w => w.count > 0)

  windows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.durationSeconds !== a.durationSeconds) return b.durationSeconds - a.durationSeconds
    return a.start - b.start
  })

  return windows
}

function addWindowNames(widget, win, font) {
  const names = win.people
  if (names.length === 0) return
  const maxShown = 3
  const label = names.length > maxShown
    ? `${names.slice(0, maxShown).join(", ")} +${names.length - maxShown} more`
    : names.join(", ")
  const namesText = widget.addText(label)
  namesText.font = font
  namesText.textColor = Color.gray()
  namesText.lineLimit = 2
}

function addSmallSummary(widget, data, windowed) {
  const today = windowed[0]
  const ranked = rankWindowsForDay(today.slots, data.timeIncrement || 1800)
  if (ranked.length === 0) {
    const t = widget.addText("No availability today")
    t.font = Font.systemFont(12)
    return
  }

  const best = ranked[0]
  const runnerUp = ranked[1]

  const big = widget.addText(`${best.count}/${data.totalPeople}`)
  big.font = Font.boldSystemFont(28)
  big.textColor = data.totalPeople > 0 && best.count === data.totalPeople
    ? new Color("#34c759")
    : Color.dynamic(Color.black(), Color.white())

  const sub = widget.addText("best overlap today")
  sub.font = Font.systemFont(10)
  sub.textColor = Color.gray()

  widget.addSpacer(4)
  const when = widget.addText(`${formatTime(best.start)}–${formatTime(best.end)}`)
  when.font = Font.systemFont(12)

  addWindowNames(widget, best, Font.systemFont(10))

  if (runnerUp) {
    widget.addSpacer(6)
    const runnerLabel = widget.addText(`Runner-up · ${runnerUp.count}/${data.totalPeople} · ${formatTime(runnerUp.start)}–${formatTime(runnerUp.end)}`)
    runnerLabel.font = Font.systemFont(9)
    runnerLabel.textColor = Color.gray()
    runnerLabel.lineLimit = 2
    addWindowNames(widget, runnerUp, Font.systemFont(9))
  }
}

function buildWidget(data) {
  const widget = new ListWidget()
  widget.url = data.url
  widget.backgroundColor = Color.dynamic(Color.white(), new Color("#1c1c1e"))
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000)

  const family = config.widgetFamily || "medium"
  const windowed = buildGrid(data.slots)

  if (family === "small") {
    widget.setPadding(12, 12, 12, 12)
    const header = widget.addStack()
    const title = header.addText(data.title || "Timeful")
    title.font = Font.boldSystemFont(12)
    title.lineLimit = 1
    header.addSpacer()
    if (data.stale) {
      const badge = header.addText("offline")
      badge.font = Font.systemFont(9)
      badge.textColor = Color.orange()
    }
    widget.addSpacer(4)
    addSmallSummary(widget, data, windowed)
    widget.addSpacer()
    const footer = widget.addText(`${data.totalPeople} ${data.totalPeople === 1 ? "person" : "people"}`)
    footer.font = Font.systemFont(8)
    footer.textColor = Color.gray()
  } else {
    // Drawn as one full-bleed background image (title, grid, and footer all
    // included) instead of a fixed-size inline image — backgroundImage
    // stretches to the widget's real on-device bounds, whereas addImage's
    // static imageSize left it pinned small in the corner on devices whose
    // actual widget frame is bigger than our approximated canvas size.
    widget.setPadding(0, 0, 0, 0)
    widget.backgroundImage = drawFullWidget(data, family, windowed)
  }

  return widget
}

function errorWidget(message) {
  const widget = new ListWidget()
  const text = widget.addText(message)
  text.font = Font.systemFont(12)
  text.textColor = Color.red()
  return widget
}

async function presentWidget(widget) {
  if (config.runsInWidget) {
    Script.setWidget(widget)
  } else {
    await widget.presentMedium()
  }
  Script.complete()
}

try {
  await run()
} catch (e) {
  log(`unhandled: ${e.message}\n${e.stack || ""}`)
  await presentWidget(errorWidget(`Unhandled error:\n${e.message}`))
}
