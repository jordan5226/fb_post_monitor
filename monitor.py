#!/usr/bin/env python3
import json
import shlex
import subprocess
import sys
import time
import zlib
from pathlib import Path

_builtin_print = print


def print(*args, **kwargs):
    """Print every output line with an HH:MM:SS timestamp."""
    sep = kwargs.pop("sep", " ")
    end = kwargs.pop("end", "\n")
    file = kwargs.pop("file", None)
    flush = kwargs.pop("flush", True)

    message = sep.join(str(arg) for arg in args)
    lines = message.splitlines()

    if not lines:
        lines = [""]

    for line in lines:
        timestamp = time.strftime("%H:%M:%S")
        _builtin_print(
            f"[{timestamp}] {line}",
            file=file,
            flush=flush
        )

    extra_newlines = max(0, end.count("\n") - 1)
    for _ in range(extra_newlines):
        _builtin_print("", file=file, flush=flush)


BASE_DIR = Path(__file__).resolve().parent
CONFIG_FILE = BASE_DIR / "config.json"
STATE_FILE = BASE_DIR / "state.json"
SCRAPER = BASE_DIR / "scrape_fb.js"


def load_json(path, default):
    if not path.exists():
        return default

    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    tmp = path.with_suffix(path.suffix + ".tmp")

    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    tmp.replace(path)


def clean_text(text, limit=240):
    text = " ".join((text or "").split())

    if len(text) <= limit:
        return text

    return text[:limit - 1] + "…"


def notify(page_name, page_url, post):
    text = clean_text(post.get("text") or "New Facebook post")

    # Always use the current Facebook Page URL from config.json for the notification link.
    # Do not use post["url"] returned by scrape_fb.js, to avoid opening the wrong Page when monitoring multiple Pages.
    link = (page_url or "").strip()

    # Use a different notification ID for each post so notification actions do not
    # overwrite each other in Android / Termux:API.
    post_id = str(post.get("id") or "")
    notification_id = zlib.crc32(
        f"{page_name}:{post_id}".encode("utf-8")
    ) & 0x7fffffff

    cmd = [
        "termux-notification",
        "--id", str(notification_id),
        "--title", "New Facebook Page post",
        "--content", f"【{page_name}】\n{text}",
        "--priority", "high",
        "--sound",
    ]

    if link:
        cmd += [
            "--action",
            (
                "/data/data/com.termux/files/usr/bin/"
                "termux-open-url "
                + shlex.quote(link)
            )
        ]

    subprocess.run(cmd, check=False)


def keyword_match(post, keywords):
    if not keywords:
        return True

    text = (post.get("text") or "").lower()

    return any(
        keyword.strip().lower() in text
        for keyword in keywords
        if keyword.strip()
    )


def scrape(url, timeout_seconds, max_posts):
    process = subprocess.run(
        [
            "node",
            str(SCRAPER),
            url,
            str(timeout_seconds),
            str(max_posts),
        ],
        cwd=str(BASE_DIR),
        capture_output=True,
        text=True,
        timeout=timeout_seconds + 30,
    )

    if process.stderr.strip():
        print(process.stderr.strip())

    if not process.stdout.strip():
        raise RuntimeError(
            f"Scraper returned no data, exit={process.returncode}"
        )

    try:
        data = json.loads(process.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"Scraper returned invalid JSON: {e}"
        )

    if not data.get("ok"):
        raise RuntimeError(
            data.get("error", "Unknown scraping error")
        )

    return data


def check_once(config, state):
    changed = False

    timeout_seconds = int(
        config.get("browser_timeout_seconds", 45)
    )

    default_max_posts = max(
        1,
        int(config.get("max_posts", 5))
    )

    for page in config.get("pages", []):
        name = page.get("name", "Unnamed Page")
        url = page.get("url", "").strip()

        if not url:
            print(f"[SKIP] {name}: URL is missing")
            continue

        keywords = page.get(
            "keywords",
            config.get("keywords", [])
        )

        max_posts = max(
            1,
            int(page.get("max_posts", default_max_posts))
        )

#        print(f"[CHECK] {name}")

        try:
            result = scrape(
                url,
                timeout_seconds,
                max_posts
            )
        except Exception as e:
            print(f"[ERROR] {name}: {e}")
            continue

        posts = result.get("posts", [])

#        print(
#            f"[INFO] {name}: "
#            f"Retrieved {len(posts)} candidate posts"
#        )

        if not posts:
            print(
                f"[WARN] {name}: No posts found"
            )
            continue

        page_state = state.setdefault(
            name,
            {"seen": []}
        )

        seen = page_state.setdefault(
            "seen",
            []
        )

        seen_set = set(seen)

        # DEBUG: List all candidate posts returned by the scraper in this cycle,
        # and indicate whether each post already exists in state.json.
#        print(f"[DEBUG] {name}: Retrieved {len(posts)} candidate posts in this cycle")

#        for i, post in enumerate(posts):
#            pid = str(post.get("id") or "")
#            status = "SEEN" if pid in seen_set else "UNSEEN"
#            ptime = post.get("time") or ""

#            print(
#                f"[POST] {name} "
#                f"index={i} "
#                f"{status} "
#                f"id={pid} "
#                f"time={ptime} "
#                f"text={clean_text(post.get('text', ''), 100)}"
#            )

        # On the first successful scrape, only create the initial baseline and do not notify about existing posts.
        if not seen:
            page_state["seen"] = [
                post["id"]
                for post in posts
                if post.get("id")
            ][:100]

            changed = True

            print(
                f"[INIT] {name}: "
                f"Initialized baseline with {len(page_state['seen'])} posts"
            )

            continue

        unseen = []

        for post in posts:
            post_id = post.get("id")

            if not post_id:
                continue

            # Stop at the first previously seen post; this marks the end of the new-post section.
            if post_id in seen_set:
                break

            unseen.append(post)

        # Posts are ordered from newest to oldest.
        # If multiple new posts are found, reverse them so notifications are sent from oldest to newest.
        for post in reversed(unseen):
            if keyword_match(post, keywords):
                print(
                    f"[NEW] {name}: ",
                    f"{clean_text(post.get('text', ''), 120)}"
                )

                notify(name, url, post)
            else:
                print(
                    f"[FILTER] {name}: "
                    "New post did not match any keyword"
                )

            seen.insert(0, post["id"])
            seen_set.add(post["id"])
            changed = True

        page_state["seen"] = seen[:100]

    if changed:
        save_json(STATE_FILE, state)


def main():
    if not CONFIG_FILE.exists():
        print(f"Configuration file not found: {CONFIG_FILE}")
        sys.exit(1)

    config = load_json(CONFIG_FILE, {})
    state = load_json(STATE_FILE, {})

    interval = max(
        60,
        int(config.get("interval_seconds", 180))
    )

    once = "--once" in sys.argv

    while True:
        try:
            check_once(config, state)

        except KeyboardInterrupt:
            print("\nMonitoring stopped")
            return

        except Exception as e:
            print(
                f"[ERROR] "
                f"{type(e).__name__}: {e}"
            )

        if once:
            return

#        print(f"[SLEEP] {interval} seconds")
        time.sleep(interval)


if __name__ == "__main__":
    main()
