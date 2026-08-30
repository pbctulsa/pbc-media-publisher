# PBC Media Publisher

A volunteer-friendly sermon publishing portal for Peniel Baptist Church in Tulsa.

The workflow lets a volunteer trim and export the sermon on the church iMac, open this website, choose the finished video, enter the sermon details, review it, and publish once. The portal then sends the sermon to:

- YouTube and the church sermon playlist
- Planning Center / Church Center Sermons
- The existing Buzzsprout podcast (optional audio export, once connected)

## Current status

The portal is deployed at `https://sermon-publisher.pbctulsa.org` and protected by Cloudflare Access. It uploads videos directly from the volunteer's browser to YouTube using Google's resumable protocol, so Cloudflare Stream storage is not required. The portal also adds each video to the PBC Sermons playlist; the separate daily sermon-sync automation then publishes it to Church Center.

## Publishing flow

1. A volunteer signs in through Cloudflare Access.
2. The volunteer selects the finished video and optionally its matching MP3/M4A audio export (up to 95 MB), then enters the title, speaker, date, scripture, description, and visibility once.
3. The volunteer reviews the sermon and authorizes the church Google/YouTube account.
4. The browser uploads the video directly to YouTube in resumable chunks and adds it to the PBC Sermons playlist.
5. The existing daily sermon-sync automation publishes the playlist video to Church Center.
6. If audio is selected, the Worker creates an unpublished episode in the existing Buzzsprout show and streams the audio attachment into that episode. It remains a draft unless the volunteer explicitly chooses to publish. Buzzsprout processing and directory updates take additional time.

No audio conversion helper, Cloudflare Stream, R2 storage, new podcast show, or RSS migration is needed. Normal Buzzsprout subscription limits still apply. Podcast controls remain disabled until both Buzzsprout settings below are present. Presence is not a live credential check; verify a real draft upload before onboarding volunteers.

### Retries and security

- Confirmed YouTube video and Buzzsprout episode IDs are saved in browser storage. Retrying audio uses the same episode, without uploading the video again. After refreshing, select the exact same video file (name, size, modification time) and audio to recover progress in the same browser.
- If draft creation has an uncertain outcome, the portal stops. An administrator must inspect Buzzsprout using the `pbc-youtube-VIDEO_ID` GUID; do not clear browser storage and retry blindly. This avoids automatic duplicate creation, but is not a cross-browser/server-side idempotency guarantee.
- Audio upload retry replaces the attachment on the same unpublished episode. It is never automatically retried. Already-published audio cannot be replaced through this endpoint.
- The Buzzsprout token stays on the Worker. Audio is streamed, not buffered or persisted there. The portal cap of 95 MB leaves room below Cloudflare's request limit; use a compressed audio export rather than WAV.
- Write endpoints require the exact custom hostname, same-origin requests, and the Cloudflare Access identity header. Keep the Access application protecting **all paths** on `sermon-publisher.pbctulsa.org`; do not add bypass policies. `workers_dev` stays disabled and preview hostnames are rejected. The identity header is trusted only behind that Access boundary.
- Test uploads default to unpublished drafts, independently of YouTube visibility. No migration or changes are made to Planning Center audio.

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
npm test
```

## Runtime configuration

Store this value as a Cloudflare Worker runtime secret so dashboard deployments preserve it:

- Google OAuth 2.0 Web application client ID (`YOUTUBE_CLIENT_ID`)
- Buzzsprout API token from My Account (`BUZZSPROUT_API_TOKEN`)
- The numeric ID of the **existing** podcast (`BUZZSPROUT_PODCAST_ID`; may be a Worker runtime secret or variable)

Never paste API tokens in chat, browser code, or the repository. After adding the Buzzsprout token and podcast ID, reload the portal and run a short unpublished audio test. Verify the title, speaker, audio playback, and draft status in the intended show before choosing Publish. See [Buzzsprout's official episode API](https://github.com/buzzsprout/buzzsprout-api/blob/master/sections/episodes.md).

The OAuth client must allow `https://sermon-publisher.pbctulsa.org` as an authorized JavaScript origin. The YouTube API key used by the existing sermon sync can read public playlist data, but uploading videos requires OAuth authorization from the church YouTube account.
