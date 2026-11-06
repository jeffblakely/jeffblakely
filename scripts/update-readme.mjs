// Refreshes the auto-generated sections of README.md:
//   <!-- prs:start --> … <!-- prs:end -->        open-source pull requests
//   <!-- videos:start --> … <!-- videos:end -->  latest "AI in 5" videos
// Runs in GitHub Actions (see .github/workflows/update-readme.yml) or locally:
//   GITHUB_TOKEN=$(gh auth token) node scripts/update-readme.mjs
// No dependencies; needs Node 20+ for global fetch.

import { readFileSync, writeFileSync } from 'node:fs';

const USER = 'jeffblakely';
const YOUTUBE_CHANNEL_ID = 'UCWe1eBfmnZ6of0zU0owml8A';
const MAX_PRS = 8;
const MAX_VIDEOS = 4;
const README = new URL('../README.md', import.meta.url);

const monthYear = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

const escapeMd = (text) => text.replace(/([\\`*_[\]<>|])/g, '\\$1');

async function github(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': `${USER}-profile-readme` };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return res.json();
}

/** Public PRs to other people's repos: merged ones, plus open ones still in review. */
async function prSection() {
  const q = (state) =>
    encodeURIComponent(`author:${USER} is:pr is:public -user:${USER} ${state}`);
  const [merged, open] = await Promise.all([
    github(`/search/issues?q=${q('is:merged')}&sort=updated&order=desc&per_page=${MAX_PRS}`),
    github(`/search/issues?q=${q('is:open')}&sort=updated&order=desc&per_page=${MAX_PRS}`),
  ]);
  const rows = [
    ...open.items.map((pr) => ({ pr, icon: '🟡', status: 'in review', when: pr.created_at })),
    ...merged.items.map((pr) => ({ pr, icon: '🟣', status: 'merged', when: pr.pull_request.merged_at ?? pr.closed_at })),
  ]
    .sort((a, b) => new Date(b.when) - new Date(a.when))
    .slice(0, MAX_PRS);
  if (!rows.length) return '_Nothing public yet. Check back soon._';
  return rows
    .map(({ pr, icon, status, when }) => {
      const repo = pr.repository_url.replace('https://api.github.com/repos/', '');
      return `- ${icon} **[${repo}](https://github.com/${repo})**: [${escapeMd(pr.title)}](${pr.html_url}) <sub>${status} · ${monthYear(when)}</sub>`;
    })
    .join('\n');
}

/** Latest uploads from the channel's public RSS feed. */
async function videoSection() {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`);
  if (!res.ok) throw new Error(`YouTube feed ${res.status}`);
  const xml = await res.text();
  const decode = (s) =>
    s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, MAX_VIDEOS).map(([, e]) => ({
    id: e.match(/<yt:videoId>([^<]+)/)?.[1],
    title: decode(e.match(/<title>([^<]+)/)?.[1] ?? '').replace(/\s*\|\s*AI in 5\s*$/i, ''),
    published: e.match(/<published>([^<]+)/)?.[1],
  }));
  if (!entries.length) return '_New videos coming soon._';
  return entries
    .map(({ id, title, published }) => `- ▶️ [${escapeMd(title)}](https://www.youtube.com/watch?v=${id}) <sub>${monthYear(published)}</sub>`)
    .join('\n');
}

function replaceSection(text, name, body) {
  const pattern = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!pattern.test(text)) throw new Error(`README is missing the ${name} markers`);
  return text.replace(pattern, `$1\n${body}\n$2`);
}

let readme = readFileSync(README, 'utf8');
const original = readme;
// Each section updates on its own: a failing source keeps its last good content.
for (const [name, build] of [['prs', prSection], ['videos', videoSection]]) {
  try {
    readme = replaceSection(readme, name, await build());
  } catch (err) {
    console.warn(`Skipping ${name}: ${err.message}`);
  }
}
if (readme !== original) {
  writeFileSync(README, readme);
  console.log('README updated.');
} else {
  console.log('README already current.');
}
