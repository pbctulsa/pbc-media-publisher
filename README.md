# PBC Media Publisher

A volunteer-friendly sermon publishing portal for Peniel Baptist Church in Tulsa.

The finished workflow will let a volunteer trim and export the sermon on the church iMac, open this website, choose the finished video, enter the sermon details, and publish once. The portal will then send the sermon to:

- YouTube and the church sermon playlist
- Planning Center / Church Center Sermons
- Planning Center's podcast feed for Apple Podcasts and Spotify

## Current status

The deployable Cloudflare Worker and first upload-screen prototype are in place. The screen only previews a video locally; it does **not** upload or publish anything yet. This keeps the first deployment safe while authentication and service credentials are configured.

## Planned publishing flow

1. A volunteer signs in through Cloudflare Access.
2. The browser uploads the finished video directly to Cloudflare Stream using a one-time upload URL.
3. The volunteer reviews the title, speaker, date, description, and thumbnail.
4. A Cloudflare Workflow uploads the video to YouTube with OAuth and adds it to the sermon playlist.
5. The workflow creates and publishes the Church Center episode, including the YouTube URL, thumbnail, and podcast audio.
6. Each destination and retry is recorded so a sermon cannot be published twice accidentally.

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

## Secrets (not yet connected)

These values must be stored as Cloudflare secrets and must never be committed:

- Cloudflare Stream API credentials
- Google OAuth client ID, client secret, and YouTube refresh token
- Planning Center client ID and secret

The YouTube API key used by the existing sermon sync can read public playlist data, but uploading videos requires OAuth authorization from the church YouTube account.

