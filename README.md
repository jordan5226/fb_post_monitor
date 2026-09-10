# Facebook Page Post Monitor for Termux

A lightweight Facebook Page post monitor designed to run directly on Android with **Termux**.

It launches Chromium in headless mode, reads the latest publicly visible posts from Facebook Pages without requiring a Facebook login, tracks previously seen posts, and sends Android notifications through Termux:API when new posts are detected.

> This project relies on Facebook's publicly rendered page structure. Facebook may change its DOM or anonymous browsing behavior at any time, which can require updates to the scraper.

## Features

- Runs directly on Android with Termux
- No Facebook login or session required
- Uses headless Chromium
- Monitors multiple Facebook Pages
- Optional keyword filtering per Page
- Keeps track of previously seen posts
- Avoids notifying existing posts on first launch
- Sends Android notifications through Termux:API
- Supports background monitoring

## Requirements

- Android
- Termux
- Termux:API
- Python 3
- Node.js
- Chromium
- `puppeteer-core`

The scraper expects Chromium at:

```text
/data/data/com.termux/files/usr/bin/chromium-browser
```

You can override it with the `CHROMIUM_PATH` environment variable.

## Project Structure

```text
.
├── monitor.py
├── scrape_fb.js
├── config.json
├── state.json
├── start.sh
├── stop.sh
├── install.sh
├── package.json
├── package-lock.json
└── README.md
```

## Installation

Clone the repository:

```bash
git clone https://github.com/jordan5226/fb_post_monitor.git
cd fb_post_monitor
```

Make the scripts executable:

```bash
chmod +x install.sh start.sh stop.sh monitor.py
```

Run the installer:

```bash
./install.sh
```

If Termux has not been granted access to shared storage yet:

```bash
termux-setup-storage
```

## Configuration

Create `config.json` in the project directory.

Example:

```json
{
  "interval_seconds": 180,
  "browser_timeout_seconds": 45,
  "max_posts": 5,
  "keywords": [],
  "pages": [
    {
      "name": "Example Page",
      "url": "https://www.facebook.com/100000000000000/",
      "keywords": []
    }
  ]
}
```

### Options

| Option | Description |
| --- | --- |
| `interval_seconds` | Delay between monitoring cycles |
| `browser_timeout_seconds` | Maximum browser operation timeout |
| `max_posts` | Maximum number of candidate posts to inspect per Page |
| `keywords` | Global keyword filter |
| `pages` | List of Facebook Pages to monitor |
| `pages[].name` | Name used in logs and notifications |
| `pages[].url` | Facebook Page URL |
| `pages[].keywords` | Optional Page-specific keyword list |
| `pages[].max_posts` | Optional Page-specific post limit |

If the keyword list is empty, every detected new post is accepted.

## First Run

Test the monitor in the foreground:

```bash
python monitor.py --once
```

On the first successful scrape, the current posts are stored as the initial baseline. Existing posts are not reported as new.

Example:

```text
[INIT] Example Page: Initialized baseline with 5 posts
```

## Start in Background

```bash
./start.sh
```

View the log:

```bash
tail -f monitor.log
```

## Stop

```bash
./stop.sh
```

This stops the Python monitor, terminates Chromium processes started by the monitor, and releases the Termux wake lock.

## How New Posts Are Detected

The scraper returns posts ordered from newest to oldest.

Each post receives a fingerprint derived from normalized post text. The monitor stores previously seen fingerprints in `state.json`.

To reduce false positives when an old post becomes visible because a newer post was deleted, only consecutive unseen posts at the top of the feed are treated as new.

Example:

```text
NEW
NEW
SEEN
SEEN
```

The first two posts are treated as new.

But:

```text
SEEN
SEEN
SEEN
UNSEEN
```

The bottom `UNSEEN` post is not considered newly published because a previously seen post was encountered first.

## Notifications

New matching posts are sent through `termux-notification`.

Notifications include:

- Facebook Page name
- Extracted post text
- A unique notification ID

The notification action opens the configured Facebook Page URL.

## Keyword Filtering

Keywords are matched case-insensitively against the extracted post text.

Example:

```json
{
  "name": "Example Page",
  "url": "https://www.facebook.com/100000000000000/",
  "keywords": ["sale", "event", "announcement"]
}
```

If none of the keywords match, the post is recorded as seen but no notification is sent.

## State File

`state.json` is generated and updated automatically. It stores previously seen post fingerprints.

If `state.json` is deleted, the next successful run creates a new baseline.

## Android Battery Settings

Android may suspend Termux in the background. For more reliable monitoring:

1. Disable battery optimization for Termux.
2. Allow Termux to run in the background.
3. Allow notifications for Termux:API.
4. Keep the Termux wake lock enabled while monitoring.

`start.sh` automatically requests a Termux wake lock.

## Chromium Notes

The scraper launches Chromium with Android-compatible flags such as:

```text
--no-sandbox
--disable-setuid-sandbox
--disable-gpu
--disable-dev-shm-usage
--single-process
--no-zygote
--jitless
--no-first-run
--no-default-browser-check
```

## Limitations

This project does not use the official Facebook Graph API. It reads the publicly rendered Facebook Page DOM instead.

As a result:

- Facebook DOM changes may break post detection.
- Anonymous Facebook pages may display fallback or unsupported-browser layouts.
- Shared or quoted content may occasionally be interpreted as separate content.
- Anonymous fallback pages may not expose stable permanent post IDs.
- Editing an existing post can change its text-based fingerprint.
- Dynamic text such as reaction counts, comment counts, and relative timestamps is filtered where possible to reduce false detections.
- Facebook may rate-limit or block automated browsing.

This project is best suited for lightweight personal monitoring of publicly accessible Pages.

## Troubleshooting

### Chromium does not start

```bash
which chromium-browser
chromium-browser --version
```

To use a different executable:

```bash
export CHROMIUM_PATH=/path/to/chromium
```

### No posts are detected

Run a foreground check:

```bash
python -u monitor.py --once
```

Then inspect whether Facebook's anonymous page layout has changed.

### Notifications do not appear

Test Termux:API manually:

```bash
termux-notification --title "FB Monitor Test" --content "Notification test"
```

### Background process is not running

```bash
pgrep -af monitor.py
tail -n 100 monitor.log
```

## Dependencies

If the `package.json` file exists, please install the Node.js dependencies using the following command:

```bash
npm install
```

If `package-lock.json` is exist:

```bash
npm ci
```

## Disclaimer

This project is an unofficial tool and is not affiliated with, endorsed by, or sponsored by Meta or Facebook.

Use it responsibly and ensure your use complies with applicable laws, platform policies, and Facebook's terms of service.
