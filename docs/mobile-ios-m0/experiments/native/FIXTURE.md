# Synthetic MP3 Fixtures

Five small, locally generated 440 Hz sine signals, not songs, voices, user
uploads or third-party recordings. These files are test-only, outside public
and the production Worker import graph. Combined MP3 size: 132,395 bytes.

`manifest.json` records each hash, encoder arguments and independent FFmpeg
packet sample counts and decoded PCM sample counts. The parser under test is
not used to produce those expected measurements. CBR stereo, VBR stereo,
MPEG-2 mono, a short preview and a raw stream without Xing/ID3 are covered.
Mutation tests derive corrupt inputs in memory; they do not ship as fixtures.

To regenerate locally, use an FFmpeg executable with libmp3lame, set `FFMPEG`
to its path if needed, then run `npm run generate:music:mp3-fixtures`. Generation
used FFmpeg 4.4. Other encoder builds may change hashes/packets: review those
changes explicitly. CI reads the committed files and never downloads or runs
FFmpeg. No executable, decoded PCM or large boundary file is stored here.

The 32 MiB boundary input is produced incrementally during tests by repeating
a real encoded frame; it tests parser resource limits, not perceptual quality.
The full and preview sine sources have the same frequency and source start,
but that alone is not an automated proof of arbitrary user audio provenance.
