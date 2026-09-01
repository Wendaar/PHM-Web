// scripts/update-phm-tv.mjs
import { readFile, writeFile } from "fs/promises";

const API_KEY = process.env.YT_API_KEY;
const CHANNEL_ID =
  process.env.YT_CHANNEL_ID || "UCQZv6ak1WpuZLoqz0FT1aqg";

const MAX_SHOW = 7;

if (!API_KEY) {
  console.error("Missing YT_API_KEY env variable");
  process.exit(1);
}

async function fetchJson(url) {
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json();
}


// ======================================================
// 1. ZJISTÍME UPLOADS PLAYLIST KANÁLU
// ======================================================

async function getUploadsPlaylistId() {
  const url =
    "https://www.googleapis.com/youtube/v3/channels" +
    "?part=contentDetails" +
    "&id=" + encodeURIComponent(CHANNEL_ID) +
    "&key=" + encodeURIComponent(API_KEY);

  const data = await fetchJson(url);

  if (
    !data.items ||
    !data.items.length ||
    !data.items[0].contentDetails ||
    !data.items[0].contentDetails.relatedPlaylists
  ) {
    throw new Error("Could not find uploads playlist for channel.");
  }

  return data.items[0].contentDetails.relatedPlaylists.uploads;
}


// ======================================================
// 2. POSLEDNÍ VIDEA Z UPLOADS PLAYLISTU
// ======================================================

async function loadLatest(uploadsPlaylistId) {
  const url =
    "https://www.googleapis.com/youtube/v3/playlistItems" +
    "?part=snippet,contentDetails" +
    "&playlistId=" + encodeURIComponent(uploadsPlaylistId) +
    "&maxResults=15" +
    "&key=" + encodeURIComponent(API_KEY);

  const data = await fetchJson(url);

  return data.items || [];
}


// ======================================================
// 3. AKTUÁLNÍ LIVE STREAM
// ======================================================

async function loadLive() {
  const url =
    "https://www.googleapis.com/youtube/v3/search" +
    "?part=snippet" +
    "&channelId=" + encodeURIComponent(CHANNEL_ID) +
    "&eventType=live" +
    "&type=video" +
    "&maxResults=10" +
    "&key=" + encodeURIComponent(API_KEY);

  const data = await fetchJson(url);

  return data.items || [];
}


// ======================================================
// 4. PŘEVOD LIVE VIDEÍ
// ======================================================

function simplifyLive(items) {
  return items
    .map(function (item) {
      const id = item.id && item.id.videoId;

      if (!id || !item.snippet) return null;

      const sn = item.snippet;

      const thumb =
        (sn.thumbnails &&
          (sn.thumbnails.medium ||
            sn.thumbnails.high ||
            sn.thumbnails.default)) ||
        {};

      return {
        id: id,
        title: sn.title || "",
        thumbnail: thumb.url || "",
        isLive: true,
        publishedAt: sn.publishedAt || ""
      };
    })
    .filter(Boolean);
}


// ======================================================
// 5. PŘEVOD VIDEÍ Z UPLOADS PLAYLISTU
// ======================================================

function simplifyLatest(items) {
  return items
    .map(function (item) {
      if (!item.snippet) return null;

      const sn = item.snippet;

      const id =
        (item.contentDetails && item.contentDetails.videoId) ||
        (sn.resourceId && sn.resourceId.videoId);

      if (!id) return null;

      const thumb =
        (sn.thumbnails &&
          (sn.thumbnails.medium ||
            sn.thumbnails.high ||
            sn.thumbnails.default)) ||
        {};

      return {
        id: id,
        title: sn.title || "",
        thumbnail: thumb.url || "",
        isLive: false,
        publishedAt:
          (item.contentDetails &&
            item.contentDetails.videoPublishedAt) ||
          sn.publishedAt ||
          ""
      };
    })
    .filter(Boolean);
}


// ======================================================
// 6. SPOJÍME LIVE + POSLEDNÍ VIDEA
// ======================================================

function mergeVideos(live, latest) {
  const seen = new Set();
  const result = [];

  // LIVE vždy první
  for (const video of live) {
    if (!video.id || seen.has(video.id)) continue;

    seen.add(video.id);
    result.push(video);
  }

  // potom poslední uploady
  for (const video of latest) {
    if (!video.id || seen.has(video.id)) continue;

    seen.add(video.id);
    result.push(video);
  }

  return result.slice(0, MAX_SHOW);
}


// ======================================================
// 7. POJISTKA PROTI SMAZÁNÍ FUNKČNÍHO FEEDU
// ======================================================

async function getPreviousFeed() {
  try {
    const raw = await readFile("phm-tv.json", "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}


// ======================================================
// MAIN
// ======================================================

async function main() {
  console.log("Fetching PHM TV data...");

  const uploadsPlaylistId = await getUploadsPlaylistId();

  console.log("Uploads playlist:", uploadsPlaylistId);

  const [liveRaw, latestRaw] = await Promise.all([
    loadLive(),
    loadLatest(uploadsPlaylistId)
  ]);

  console.log("LIVE results:", liveRaw.length);
  console.log("Latest uploads:", latestRaw.length);

  const live = simplifyLive(liveRaw);
  const latest = simplifyLatest(latestRaw);

  const items = mergeVideos(live, latest);

  console.log("Final items:", items.length);

  // --------------------------------------------------
  // POJISTKA:
  // pokud YouTube z nějakého důvodu vrátí 0 videí,
  // NEPŘEPÍŠEME funkční feed prázdným JSONem.
  // --------------------------------------------------

  if (items.length === 0) {
    const previous = await getPreviousFeed();

    if (
      previous &&
      Array.isArray(previous.items) &&
      previous.items.length > 0
    ) {
      console.warn(
        "YouTube returned 0 items. Keeping previous feed with " +
          previous.items.length +
          " items."
      );

      return;
    }

    console.warn(
      "YouTube returned 0 items and no previous feed exists."
    );
  }

  const payload = {
    updated: new Date().toISOString(),
    channelId: CHANNEL_ID,
    items: items
  };

  await writeFile(
    "phm-tv.json",
    JSON.stringify(payload, null, 2),
    "utf8"
  );

  console.log(
    `Wrote phm-tv.json with ${items.length} items`
  );
}


main().catch(function (err) {
  console.error("PHM TV update failed:");
  console.error(err);
  process.exit(1);
});
