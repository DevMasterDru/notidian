---
type: review
status: awaiting-review
review:
  comments_version: 1
  comments:
    - id: cmt-valid1
      anchor: "^c-anchor"
      quote: "Review selected text"
      body: "Keep this valid sibling."
      by: human
      ts: "2026-07-15T10:00:00.000Z"
      status: open
    - id: cmt-invalid1
      anchor: "not-a-block-id"
      quote: "Broken entry"
      body: ""
      by: human
      ts: "not-a-timestamp"
      status: pending
---
Review selected text ^c-anchor
