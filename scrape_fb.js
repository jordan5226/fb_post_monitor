const puppeteer = require("puppeteer-core");
const crypto = require("crypto");

const inputUrl = process.argv[2];
const timeoutSeconds = parseInt(process.argv[3] || "45", 10);
const maxPosts = Math.max(1, parseInt(process.argv[4] || "5", 10));
const timeout = timeoutSeconds * 1000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function createConfiguredPage(browser) {
    const page = await browser.newPage();

    await page.setViewport({
        width: 1080,
        height: 1800
    });

    await page.setUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Mobile) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/131.0.0.0 Mobile Safari/537.36"
    );

    await page.setRequestInterception(true);

    page.on("request", request => {
        if (["image", "media", "font"].includes(request.resourceType())) {
            request.abort();
        } else {
            request.continue();
        }
    });

    return page;
}

function isRetryableNavigationError(error) {
    const message = String(error || "");

    return (
        message.includes("ERR_SOCKET_NOT_CONNECTED") ||
        message.includes("ERR_CERT_VERIFIER_CHANGED") ||
        message.includes("ERR_NAME_NOT_RESOLVED") ||
        message.includes("ERR_CONNECTION_RESET") ||
        message.includes("ERR_NETWORK_CHANGED") ||
        message.includes("ERR_INTERNET_DISCONNECTED")
    );
}

async function openPageWithRetry(browser, url, timeout, retries = 3) {
    let lastError = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
        let page = null;

        try {
            page = await createConfiguredPage(browser);

            await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout
            });

            return page;
        } catch (error) {
            lastError = error;

            if (page) {
                await page.close().catch(() => {});
            }

            if (!isRetryableNavigationError(error) || attempt >= retries) {
                throw error;
            }

            const delayMs = attempt * 3000;

            console.error(
                `[RETRY] Navigation failed (${attempt}/${retries}): ` +
                `${String(error && error.message ? error.message : error)}`
            );
            console.error(
                `[RETRY] Waiting ${delayMs / 1000} seconds before retrying...`
            );

            await sleep(delayMs);
        }
    }

    throw lastError;
}

(async () => {
    let browser = null;
    let page = null;

    try {
        const executablePath =
            process.env.CHROMIUM_PATH ||
            "/data/data/com.termux/files/usr/bin/chromium-browser";

        browser = await puppeteer.launch({
            executablePath,
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--single-process",
                "--no-zygote",
                "--jitless",
                "--no-first-run",
                "--no-default-browser-check"
            ]
        });

        page = await openPageWithRetry(
            browser,
            inputUrl,
            timeout,
            3
        );

        await sleep(7000);

        // Read the latest rendered posts while the page is still at the top.
        // Do not scroll first and then filter using viewport-relative coordinates.
        const result = await page.evaluate((maxPosts) => {

            function normalizeText(text) {
                return (text || "")
                    .replace(/\u00a0/g, " ")
                    .replace(/[\u{F0000}-\u{FFFFD}]/gu, " ")
                    .replace(/[\u{100000}-\u{10FFFD}]/gu, " ")
                    .replace(/\s+/g, " ")
                    .trim();
            }

            function getPageName() {
                const first =
                    document.querySelector('[data-testid^="post-profile-image-"]');

                if (first) {
                    const label = first.getAttribute("aria-label") || "";
                    const name = label
                        .replace(/\s+Profile Picture$/i, "")
                        .trim();

                    if (name)
                        return name;
                }

                const title = document.title || "";
                const m = title.match(/^Profile for\s+(.+)$/i);
                return m ? m[1].trim() : "";
            }

            function isPostTime(el) {
                const label = el.getAttribute("aria-label") || "";

                return (
                    /\bago,\s*Public$/i.test(label) ||
                    /^[A-Z][a-z]+\s+\d{1,2},\s+\d{4},\s*Public$/i.test(label)
                );
            }

            function escapeRegExp(s) {
                return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            }

            function stripLeadingHeader(text, pageName) {
                let out = normalizeText(text);

                if (pageName) {
                    const escaped = escapeRegExp(pageName);

                    out = out.replace(
                        new RegExp("^\\s*" + escaped + "\\s*", "i"),
                        ""
                    );
                }

                // Visible relative time: 3d / 2h / 15m
                out = out
                    .replace(/^\s*\d+\s*[mhd]\s*/i, "")
                    .trim();

                return out;
            }

            function stripTrailingNextAuthor(text, pageName) {
                if (!pageName)
                    return text;

                const escaped = escapeRegExp(pageName);

                return text
                    .replace(
                        new RegExp("\\s*" + escaped + "\\s*$", "i"),
                        ""
                    )
                    .trim();
            }


            function isInteractionBoundaryText(text) {
                const s = normalizeText(text);

                if (!s)
                    return false;

                return (
                    // Reaction/comment counts are often standalone numeric text nodes.
                    // For example, a "2" after the post body may become "3" when a new comment is added.
                    // Stop only when the entire node is numeric, so numbers inside the post body such as
                    // 2330 or 155 will not be removed by mistake.
                    /^\d+$/.test(s) ||

                    /\band\s+\d+\s+others\b/i.test(s) ||
                    /\bTop fan\b/i.test(s) ||
                    /^(Like|Reply|Replies|Comment|Comments)$/i.test(s) ||
                    /^View\s+(?:all\s+)?\d*\s*comments?/i.test(s) ||
                    /^View\s+more\s+comments?/i.test(s) ||
                    /^\d+\s+comments?$/i.test(s)
                );
            }

            function isStandaloneDynamicTime(text) {
                const s = normalizeText(text);

                return (
                    /^Just now$/i.test(s) ||
                    /^Yesterday$/i.test(s) ||
                    /^\d+\s*[mhd]$/i.test(s) ||
                    /^\d+\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours|day|days)(?:\s+ago)?$/i.test(s)
                );
            }

            function extractPostBody(currentEl, nextEl, pageName) {
                const range = document.createRange();

                try {
                    range.setStartAfter(currentEl);
                    if (nextEl) {
                        range.setEndBefore(nextEl);
                    } else {
                        range.setEndAfter(document.body.lastChild);
                    }
                } catch {
                    return "";
                }

                const fragment = range.cloneContents();
                const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
                const parts = [];
                let node;
                let started = false;

                while ((node = walker.nextNode())) {
                    let chunk = normalizeText(node.nodeValue || "");
                    if (!chunk)
                        continue;

                    if (!started) {
                        if (pageName && chunk.toLowerCase() === pageName.toLowerCase())
                            continue;
                        if (isStandaloneDynamicTime(chunk))
                            continue;
                    }

                    if (isInteractionBoundaryText(chunk))
                        break;

                    const inlineMarkers = [
                        /\s+\S+(?:\s+\S+){0,3}\s+and\s+\d+\s+others\b/i,
                        /\s+and\s+\d+\s+others\b/i,
                        /\s+\d+\s+Top fan\b/i,
                        /\s+Top fan\b/i,
                        /\s+\d+\s+comments?\b/i
                    ];

                    let cutAt = -1;
                    for (const re of inlineMarkers) {
                        const m = re.exec(chunk);
                        if (m && (cutAt < 0 || m.index < cutAt))
                            cutAt = m.index;
                    }

                    if (cutAt >= 0) {
                        const before = normalizeText(chunk.substring(0, cutAt));
                        if (before)
                            parts.push(before);
                        break;
                    }

                    if (started && isStandaloneDynamicTime(chunk))
                        continue;

                    parts.push(chunk);
                    started = true;
                }

                let body = normalizeText(parts.join(" "));
                body = stripLeadingHeader(body, pageName);
                body = stripTrailingNextAuthor(body, pageName);
                return body;
            }

            const pageName = getPageName();

            const allAnchors = [
                ...document.querySelectorAll(
                    '[data-testid^="post-profile-image-"]'
                )
            ].map(el => {
                const r = el.getBoundingClientRect();

                return {
                    el,
                    left: r.left,
                    // Important fix: use document-absolute coordinates instead of viewport-relative coordinates.
                    docTop: r.top + window.scrollY,
                    testId: el.getAttribute("data-testid") || ""
                };
            }).filter(x =>
                Number.isFinite(x.left) &&
                Number.isFinite(x.docTop)
            );

            if (!allAnchors.length) {
                return {
                    pageName,
                    outerAnchorCount: 0,
                    posts: []
                };
            }

            /*
             * Outer feed post profile images are positioned at the leftmost edge;
             * profile images inside quoted/shared cards are usually indented to the right.
             */
            const minLeft = Math.min(...allAnchors.map(x => x.left));
            const OUTER_LEFT_TOLERANCE = 12;

            const outerAnchors = allAnchors
                .filter(
                    x => Math.abs(x.left - minLeft) <= OUTER_LEFT_TOLERANCE
                )
                .sort((a, b) => a.docTop - b.docTop);

            // Deduplicate repeated anchors for the same header using document Y position.
            const deduped = [];

            for (const item of outerAnchors) {
                const prev = deduped[deduped.length - 1];

                if (
                    prev &&
                    Math.abs(prev.docTop - item.docTop) < 20
                ) {
                    continue;
                }

                deduped.push(item);
            }

            const timeNodes = [
                ...document.querySelectorAll("[aria-label]")
            ]
            .filter(isPostTime)
            .map(el => {
                const r = el.getBoundingClientRect();

                return {
                    el,
                    docTop: r.top + window.scrollY,
                    left: r.left,
                    label: el.getAttribute("aria-label") || ""
                };
            });

            const posts = [];

            for (let i = 0; i < deduped.length; i++) {
                if (posts.length >= maxPosts)
                    break;

                const current = deduped[i];
                const next = deduped[i + 1] || null;

                let text = extractPostBody(
                    current.el,
                    next ? next.el : null,
                    pageName
                );

                if (!text)
                    continue;

                if (text.length > 5000) {
                    text = text.substring(0, 5000).trim();
                }

                /*
                 * Use only the time node closest vertically to the outer post header.
                 * Time nodes inside quoted/shared cards are usually farther down.
                 */
                const candidates = timeNodes
                    .filter(t => {
                        const dy = t.docTop - current.docTop;
                        return dy >= -25 && dy <= 80;
                    })
                    .sort((a, b) =>
                        Math.abs(a.docTop - current.docTop) -
                        Math.abs(b.docTop - current.docTop)
                    );

                const time =
                    candidates.length > 0
                        ? candidates[0].label
                        : "";

                posts.push({
                    text,
                    time,
                    index: posts.length
                });
            }

            return {
                pageName,
                outerAnchorCount: deduped.length,
                posts
            };

        }, maxPosts);

        function makeFingerprintText(text) {
            return (text || "")
                .replace(/\bJust now\b/gi, " ")
                .replace(/\bYesterday\b/gi, " ")
                .replace(/(?<![A-Za-z0-9])\d+\s*[mhd](?![A-Za-z0-9])/gi, " ")
                .replace(
                    /\b\d+\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours|day|days)(?:\s+ago)?\b/gi,
                    " "
                )
                .replace(/\s+/g, " ")
                .trim();
        }

        const posts = result.posts.map(post => {
            const stableText =
                (post.text || "")
                    .replace(/\s+/g, " ")
                    .trim();

            const fingerprintText = makeFingerprintText(stableText);

            const id = crypto
                .createHash("sha256")
                .update(fingerprintText, "utf8")
                .digest("hex");

            return {
                id,
                url: inputUrl,
                text: stableText,
                time: post.time,
                index: post.index
            };
        });

        process.stdout.write(
            JSON.stringify({
                ok: true,
                login_wall: false,
                final_url: page.url(),
                title: await page.title().catch(() => ""),
                page_name: result.pageName || "",
                outer_anchor_count: result.outerAnchorCount || 0,
                posts
            })
        );

    } catch (e) {
        process.stdout.write(
            JSON.stringify({
                ok: false,
                error: String(e && e.stack ? e.stack : e)
            })
        );

        process.exitCode = 1;

    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
})();
