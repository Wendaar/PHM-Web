// scripts/update-phm-tv.mjs
import { writeFile } from "fs/promises";

const API_KEY    = process.env.YT_API_KEY;
const CHANNEL_ID = process.env.YT_CHANNEL_ID || "UCQZv6ak1WpuZLoqz0FT1aqg";
const MAX_SHOW   = 7;

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

async function loadLive() {
  const url =
    "https://www.googleapis.com/youtube/v3/search"
    + "?part=snippet"
    + "&channelId=" + encodeURIComponent(CHANNEL_ID)
    + "&eventType=live"
    + "&type=video"
    + "&key=" + encodeURIComponent(API_KEY);

  const data = await fetchJson(url);
  return data.items || [];
}

async function loadLatest() {
  const url =
    "https://www.googleapis.com/youtube/v3/search"
    + "?part=snippet"
    + "&channelId=" + encodeURIComponent(CHANNEL_ID)
    + "&order=date"
    + "&type=video"
    + "&maxResults=15"
    + "&key=" + encodeURIComponent(API_KEY);

  const data = await fetchJson(url);
  return data.items || [];
}

function mergeVideos(live, latest) {
  const byId = {};
  const merged = [];

  // LIVE první
  for (const item of live) {
    const id = item.id && item.id.videoId;
    if (!id || byId[id]) continue;
    byId[id] = true;
    merged.push({ item, isLive: true });
  }

  // pak poslední videa
  for (const item of latest) {
    const id = item.id && item.id.videoId;
    if (!id || byId[id]) continue;
    byId[id] = true;
    merged.push({ item, isLive: false });
  }

  // zjednodušíme strukturu
  const simplified = merged.slice(0, MAX_SHOW).map(({ item, isLive }) => {
    const id = item.id.videoId;
    const sn = item.snippet;
    const thumb = (sn.thumbnails.medium || sn.thumbnails.default || {}).url;
    return {
      id,
      title: sn.title,
      thumbnail: thumb,
      isLive,
      publishedAt: sn.publishedAt
    };
  });

  return simplified;
}

async function main() {
  console.log("Fetching PHM TV data…");
  const live = await loadLive();
  const latest = await loadLatest();
  const items = mergeVideos(live, latest);

  const payload = {
    updated: new Date().toISOString(),
    channelId: CHANNEL_ID,
    items
  };

  await writeFile("phm-tv.json", JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote phm-tv.json with ${items.length} items`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
