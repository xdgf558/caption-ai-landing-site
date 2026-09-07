# Cat Life background music — v1.26.2

The owner approved **Moonlight Tiptoes — Soft Mix / 月亮下的小猫·柔和版** after two listening revisions. Only this accepted mix is shipped as `public/games/cat-life/src/assets/audio/moonlight-tiptoes-soft.m4a`; the original audition files and WAV masters are not deployment assets.

- Original arrangement: 40 bars, 3/4, 96 BPM, 75 seconds, 516 note events. Celesta, clarinet, pizzicato strings, bassoon, harp and quiet strings; no imported third-party song or MIDI.
- Softer revision: unchanged melody, pitches and timing. Reduced upper celesta/harp/clarinet velocities and targeted high-frequency EQ, preserving the approved cartoon-serenade character.
- AAC stereo delivery: 128 kbps, approximately 1.1 MB. SHA-256 `2e853e7d5eaa5673053a442a9ec257e470488a0a909f311e25bd22279285aba2` pins the approved loop file, not the audition with end fades.
- Master measurements: 44.1 kHz, approximately -19 dBFS RMS and -3.22 dBFS peak. Objective checks do not replace the owner's listening approval.

## Playback contract

The default music is downloaded and decoded once after a game gesture, then uses a native looping AudioBufferSource. Page changes and background UI renders do not select another track or restart it. Mute, zero volume, document hiding and pagehide stop the source with a short fade; the retained in-memory offset resumes when appropriate. Loading/decode failure stays silent, with retries only on another gesture. A late response cannot start an obsolete default source after mute or selection of custom music.

Loop end is explicitly the score's 75 seconds, not the decoded container duration: Chromium decodes approximately 22 ms of AAC tail padding beyond the master. This excludes the padding without re-encoding or changing the approved mix. The boundary test uses the actual configured loop endpoint.

Existing BGM volume/mute settings and device-local custom music remain in control. Custom audio uses its existing data URL and a looping media element, not the default buffer. Clearing it returns to the default track. Sound effects and schema 3 are unchanged. Refreshing starts a new playback session; playhead position is not written to saves. AudioContext decoding uses roughly 27 MB for the stereo loop and is lazy, not part of initial rendering.

## Sound source and license boundary

Instrument sounds were rendered locally with macOS AVAudioEngine using S. Christian Collins's [GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS). The author's [License v2.0](https://github.com/mrbumpy409/GeneralUser-GS/blob/main/documentation/LICENSE.txt) permits private and commercial music production, while noting incomplete provenance records for some older samples. This is not an independent clearance guarantee for every underlying sample. The soundbank itself is not distributed with the site.

## Regression checks

`node scripts/test-cat-life-music.mjs` checks asset identity, lazy initialization, one source across redraws, resume offsets, stale-response guards, retry behavior and custom music transitions. `npx playwright test scripts/browser-tests/cat-life-music.spec.mjs` uses real Chromium AAC decoding/playback at 390px and 1280px plus an offline-rendered loop boundary. Visibility/BFCache events are simulated deterministically; these are not claims of a physical iPhone background-playback test. Existing release-history tests verify that 1.26.1 notes remain archived and initially folded.

Deploy to the existing Cloudflare Worker `caption-ai-landing-site`, domain `wwwstationcat.org`, preserving the current production source and unrelated changes. No Worker logic, database migration, binding or account mutation is part of this release. Verify the live audio hash and runtime/manifest/product version after deployment.
