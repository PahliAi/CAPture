# CAPture export format

Version 1. A CAPture export is a ZIP file that mirrors the day folders on disk, minus everything the user marked private or deleted.

## Layout

```
manifest.json
2026-10-22/
  events.jsonl
  transcript.md
  screenshots/092000-2.jpg
  files/4-weekly-figures.txt
2026-10-23/
  ...
```

A one-day export has the same layout with a single day folder. The ZIP uses the STORE method (no compression) and UTF-8 names.

## manifest.json

```json
{
  "format": "capture-export",
  "version": 1,
  "createdAt": "2026-10-22T18:00:00.000Z",
  "timezone": "Europe/Amsterdam",
  "days": [
    { "date": "2026-10-22", "utcOffsetMinutes": 120, "counts": { "speech": 2, "screenshot": 3, "file": 1, "note": 1 } }
  ]
}
```

| Field | Meaning |
|---|---|
| `format` | Always `capture-export`. |
| `version` | Integer. Incremented when a change is not backwards compatible. |
| `createdAt` | When the export was made (UTC, ISO 8601). |
| `timezone` | IANA name of the timezone of the user's computer. May be empty if the browser does not tell. |
| `days` | One entry per exported day, oldest first. `utcOffsetMinutes` is how far the user's clock was ahead of UTC at noon that day (it differs across daylight-saving changes). `counts` is the number of exported items per type. |

## events.jsonl

One JSON object per line, ordered by `start`. Fields:

| Field | Type | Present | Meaning |
|---|---|---|---|
| `id` | integer | always | Unique within the day. |
| `type` | string | always | `speech`, `screenshot`, `file` or `note`. |
| `start` | string | always | UTC ISO 8601. For speech: when recording started. |
| `end` | string | always | UTC ISO 8601. Equal to `start` for point-in-time items. |
| `text` | string | speech, note | The recognised or typed text, as edited by the user. |
| `file` | string | screenshot, file | Path inside the day folder, `screenshots/...` or `files/...`. |
| `name` | string | screenshot, file | Original file name. |
| `size` | integer | screenshot, file | Size in bytes. |
| `mime` | string | screenshot, file | Media type. |
| `segments` | array | speech, when known | When each phrase of a recording was spoken (see below). |
| `source` | object | screenshot, when the browser tells | What was shared: `label` (the browser's name for the screen or window, may be empty) and `surface` (`monitor`, `window` or `browser`). |

### segments

A recording is one item, but it is made of phrases. Each entry is `{ "start", "end", "from" }`: the text from character `from` (a zero-based index into `text`) up to the next entry's `from` was spoken between `start` and `end` (UTC ISO 8601). `start` is when the first words of the phrase were heard, `end` when the speech service finalised it. The offsets follow the user's edits, so they always point at the same words of the edited `text`; text the user removed is not kept anywhere. When the user splits a recording, each half gets its own phrases and its own `start` and `end`.

Times are UTC; the day folder name is the local date on the user's computer, so an item near midnight can have a UTC date different from its folder.

## transcript.md

A readable view of the speech items of the day: one section per recording with its start and end time (local time of the user's computer). When phrase times are known, each phrase is a paragraph prefixed with `[HH:MM:SS]`; otherwise the section holds the plain text.

## What is never included

Items marked private, items deleted by the user, and the audio itself (audio is never stored, only text).
