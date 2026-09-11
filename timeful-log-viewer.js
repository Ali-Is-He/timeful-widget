// Variables used by Scriptable.
// icon-color: gray; icon-glyph: file-alt;

const fm = FileManager.local()
const LOG_PATH = fm.joinPath(fm.documentsDirectory(), "timeful-log.txt")

if (!fm.fileExists(LOG_PATH)) {
  const alert = new Alert()
  alert.title = "No log yet"
  alert.message = "timeful-widget.js hasn't run yet."
  alert.addAction("OK")
  await alert.present()
} else {
  const content = fm.readString(LOG_PATH)
  QuickLook.present(content)
}

Script.complete()
