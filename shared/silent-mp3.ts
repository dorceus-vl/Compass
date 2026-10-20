/**
 * A short silent MP3 (MPEG-1 Layer III, 128 kbps, 44.1 kHz, mono): `frames` frames of 417 bytes, each a header and zeroed side info
 * (no audio data), about 26 ms a frame. The Worker's stub answers /api/athena/speak with it (AI_STUB=1); the web app plays it inside a
 * tap so iOS lets the same audio element play Athena's voice when it arrives a moment later.
 */
export function silentMp3(frames = 8): Uint8Array {
  const FRAME = 417, out = new Uint8Array(FRAME * frames);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0xc0], i * FRAME);
  return out;
}
