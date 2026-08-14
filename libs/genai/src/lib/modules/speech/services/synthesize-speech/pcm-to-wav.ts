/**
 * Gemini's TTS models return raw PCM with no container — a bare `audio/L16`
 * (or similar) mime type carrying the sample rate in its parameters, not a
 * file a standard player can open. Every consumer needs a real container, so
 * the header is added once here rather than in each caller.
 */
export interface PcmFormat {
    sampleRateHz: number;
    bitsPerSample: number;
    channels: number;
}

/**
 * Parses `audio/L16;codec=pcm;rate=24000` into its parts. Falls back to
 * Gemini's documented default (24kHz, 16-bit, mono) if a parameter is
 * missing — safer than throwing on a minor mime-type format change from the
 * API, since the fallback matches what the API actually sends today.
 */
export function parsePcmMimeType(mimeType: string): PcmFormat {
    const rateMatch = /rate=(\d+)/.exec(mimeType);
    const bitsMatch = /L(\d+)/.exec(mimeType);

    return {
        sampleRateHz: rateMatch ? Number(rateMatch[1]) : 24000,
        bitsPerSample: bitsMatch ? Number(bitsMatch[1]) : 16,
        channels: 1,
    };
}

export function pcmToWav(pcmBase64: string, format: PcmFormat): string {
    const { sampleRateHz, bitsPerSample, channels } = format;

    const pcmData = Buffer.from(pcmBase64, "base64");
    const blockAlign = channels * (bitsPerSample / 8);
    const byteRate = sampleRateHz * blockAlign;

    const header = Buffer.alloc(44);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36 + pcmData.length, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16); // fmt chunk size (PCM)
    header.writeUInt16LE(1, 20); // audio format: 1 = PCM
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRateHz, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write("data", 36, "ascii");
    header.writeUInt32LE(pcmData.length, 40);

    return Buffer.concat([header, pcmData]).toString("base64");
}
