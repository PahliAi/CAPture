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
  "days": [
    { "date": "2026-10-22", "counts": { "speech": 2, "screenshot": 3, "file": 1, "note": 1 } }
  ]
}
```

| Field | Meaning |
|---|---|
| `format` | Always `capture-export`. |
| `version` | Integer. Incremented when a change is not backwards compatible. |
| `createdAt` | When the export was made (UTC, ISO 8601). |
| `days` | One entry per exported day, oldest first. `counts` is the number of exported items per type. |

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

Times are UTC; the day folder name is the local date on the user's computer, so an item near midnight can have a UTC date different from its folder.

## transcript.md

A readable view of the speech items of the day: one section per recording with its start and end time (local time of the user's computer) followed by the text.

## What is never included

Items marked private, items deleted by the user, and the audio itself (audio is never stored, only text).
