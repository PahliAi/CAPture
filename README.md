# CAPture

CAPture is a browser tool for capturing a working day: spoken notes, screenshots, files and short typed notes. Everything is stored in a folder you choose on your own computer, one subfolder per day. At the end of the day you review it, remove what you do not want to share, and download a ZIP.

## What it does

- **Speech** in Dutch or English: press the microphone, talk, press stop. The text and the start and end time are stored. Audio is never stored.
- **Screenshots**: share a screen once, then press the camera button (or the screenshot key) whenever you want a screenshot. Areas you draw once can be blacked out in every screenshot.
- **Files**: drop files on the page or the widget, or choose them.
- **Notes**: type a short note at any time.
- **Floating widget**: a small always-on-top window with three icons. Left-click the camera for a screenshot, the microphone to start or stop speech, the file icon to add files. Right-click the camera to choose what is captured (whole screen, one window, a browser tab, a rectangle, or ask every time) and the microphone to choose the language. An icon flashes green when it worked and red when it did not.
- **Review**: edit text, mark items private, delete or restore items, select several at once or by time, split a long text, search, and view screenshots full size.
- **Export**: one button creates a ZIP of the day, or of several days. Private and deleted items are never in it. The format is described in `docs/export-format.md`.

## Privacy

Nothing is uploaded by this tool; there is no server. The only data that leaves your computer while you use it is the audio your browser sends to its own speech recognition service while you record. Only the recognised text is kept.

## Use

Open the page in Microsoft Edge or Google Chrome and choose a folder. The page works on any regular address that is served over https.
