# Security

Template Studio is meant to be safe to use with confidential templates, including inside a regulated
organisation. This page says what it does with your data, what it defends against, what has been
checked, and what it does not cover.

## What happens to your data

- The app is a static site. There is no server-side code, no account, no database and no analytics.
- Templates, field settings and test data are read by the browser and processed in memory. Nothing is
  uploaded. A browser test fails the build if the page makes any request after it has loaded.
- Work is autosaved to the browser's own storage (IndexedDB) on that device, unencrypted, like any
  browser data. **Settings → Remove everything saved here** deletes it. Do this on shared computers.
- Every font and script is bundled. Nothing is loaded from a CDN or third party.

## Threats considered

| Threat | Defence |
|---|---|
| A hostile `.pptx` or `fill_pptx.py` is opened in the editor | Slides are drawn from parsed values only: colours are converted to numbers, pictures come only from files embedded in the template, and external links in the file are never fetched. All text is inserted as text, never as markup. |
| Hostile markup reaches the page anyway | A Content Security Policy allows scripts, fonts and requests from the site itself only (`default-src 'none'`). Injected script cannot run and data cannot be sent elsewhere. |
| The site is shown inside another site's frame (clickjacking) | The app refuses to start in a frame. |
| A zip bomb | Files over 100 MB, archives that unpack to over 400 MB, and entries that unpack to more than they declare are refused. |
| The LLM returns hostile or broken text | Its output is only ever data. It is XML-escaped, characters XML forbids are removed, and it cannot add shapes, links, macros or files to the deck. Invalid JSON gives `status: "error"`, not a crash. |
| The LLM output chooses the file name | The name is reduced to letters, digits, `_` and `-`, at most 60 characters. |
| A crafted project file injects XML through a colour rule | Colours must be six hex digits, checked when the file is opened and again by the fill engine. |
| Field names or descriptions inject code into the generated Python | Settings are embedded as a JSON string and read with `json.loads`. Nothing from the template is ever executed. |
| A compromised dependency | The app has no runtime dependencies. Build tools are locked by `package-lock.json`. CI actions are pinned to commit hashes and run with read-only permissions except for the deploy step. |

## The generated Python

`fill_pptx.py` and `pptx_kit.py`:

- use the Python standard library only (3.8+), so there is no package to vet;
- never use `eval`, `exec`, `pickle`, `subprocess` or the network;
- touch no files inside a Code node. On the command line, `fill_pptx.py` reads the one JSON file and
  writes the one output file you name, and `pptx_kit.py` reads your template and writes its kit folder
  beside it;
- treat the input JSON strictly as data;
- are short enough to read in full before approving. The engine is about 300 lines.

## What has been checked

- 121 unit and parity tests, including hostile input: control characters, lone surrogates, markup in
  values, a colour rule carrying XML, a zip bomb.
- 15 browser tests, including one that types script markup into every free-text input and confirms
  nothing runs, the content policy is present, and the app never violates it.
- Every deck the tests produce is checked for zip integrity and well-formed XML, and in CI is opened
  with python-pptx and converted with LibreOffice.

This is a self-review, not an independent penetration test or audit.

## What it does not cover

- **The content the LLM writes.** The script places text; it cannot judge whether the text is true.
  Review generated decks before they are sent anywhere.
- **Prompt injection of the LLM** through the notes you feed it. That can change what the LLM writes,
  but not what the script is able to do with it.
- **What is already inside your template.** Embedded objects, external links and anything else in the
  `.pptx` you open are passed through to the output unchanged. Start from templates you trust.
  The app only opens `.pptx`, which cannot hold macros (`.pptm` is not accepted).
- **The device.** Anyone with access to the browser profile can read autosaved templates.
- **The hosting.** The public copy is served by GitHub Pages. For internal use, host the `dist/` folder
  on your own web server instead (it is plain static files and needs no internet access), and have
  the server send `X-Frame-Options: DENY` and the same Content Security Policy as a response header.

## Reporting a problem

Open a private security advisory on the GitHub repository (Security → Report a vulnerability).
