# PBC Media Publisher

A volunteer-friendly sermon publishing portal for Peniel Baptist Church in Tulsa.

The workflow lets a volunteer trim and export the sermon on the church iMac, open this website, choose the finished video, enter the sermon details, review it, and publish once. The portal then sends the sermon to:

- YouTube and the church sermon playlist
- Planning Center / Church Center Sermons
- Planning Center's podcast feed for Apple Podcasts and Spotify (planned)

## Current status

The portal is deployed at `https://sermon-publisher.pbctulsa.org` and protected by Cloudflare Access. It uploads videos directly from the volunteer's browser to YouTube using Google's resumable protocol, so Cloudflare Stream storage is not required. The portal also adds each video to the PBC Sermons playlist; the separate daily sermon-sync automation then publishes it to Church Center.

## Planned publishing flow

1. A volunteer signs in through Cloudflare Access.
2. The volunteer selects the finished video and enters the title, speaker, date, scripture, description, and visibility.
3. The volunteer reviews the sermon and authorizes the church Google/YouTube account.
4. The browser uploads the video directly to YouTube in resumable chunks and adds it to the PBC Sermons playlist.
5. The existing daily sermon-sync automation publishes the playlist video to Church Center.
6. Podcast audio publishing will be connected separately.

## Local development

Requirements: Node.js 20 or newer.

```sh
npm install
npm run types
npm run dev
```

Then open the local address shown by Wrangler.

## Checks

```sh
npm run check
```

## Runtime configuration

Store this value as a Cloudflare Worker runtime secret so dashboard deployments preserve it:

- Google OAuth 2.0 Web application client ID (`YOUTUBE_CLIENT_ID`)

The OAuth client must allow `https://sermon-publisher.pbctulsa.org` as an authorized JavaScript origin. The YouTube API key used by the existing sermon sync can read public playlist data, but uploading videos requires OAuth authorization from the church YouTube account.
