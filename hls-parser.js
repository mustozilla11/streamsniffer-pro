// hls-parser.js - RFC 8216 Compliant HLS Master & Media Playlist Parser

export function resolveUrl(relative, base) {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

export function parseAttributes(attrString) {
  const regex = /([A-Z0-9-]+)=(?:"([^"]*)"|([^,]+))/g;
  const attrs = {};
  let match;

  while ((match = regex.exec(attrString)) !== null) {
    const key = match[1];
    const value = match[2] !== undefined ? match[2] : match[3];
    attrs[key] = value;
  }
  return attrs;
}

export function parseMasterPlaylist(manifestContent, baseUrl) {
  const lines = manifestContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const isMaster = lines.some(l => l.startsWith('#EXT-X-STREAM-INF'));

  const result = {
    isMasterPlaylist: isMaster,
    variants: [],
    audioTracks: [],
    sessionKeys: []
  };

  if (!isMaster) {
    return parseMediaPlaylist(lines, baseUrl);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Master stream variant
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attributes = parseAttributes(line.substring(18));
      const nextLine = lines[i + 1];

      if (nextLine && !nextLine.startsWith('#')) {
        const variantUrl = resolveUrl(nextLine, baseUrl);
        const [width, height] = attributes.RESOLUTION
          ? attributes.RESOLUTION.split('x').map(Number)
          : [null, null];

        const bandwidth = parseInt(attributes.BANDWIDTH, 10) || 0;
        const resolutionLabel = height ? `${height}p` : (attributes.RESOLUTION || 'Auto');

        result.variants.push({
          url: variantUrl,
          bandwidth: bandwidth,
          averageBandwidth: parseInt(attributes['AVERAGE-BANDWIDTH'], 10) || bandwidth,
          resolution: attributes.RESOLUTION || null,
          width: width,
          height: height,
          label: resolutionLabel,
          codecs: attributes.CODECS || null,
          audioGroupId: attributes.AUDIO || null
        });
      }
    }
    // Independent Audio Tracks
    else if (line.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=AUDIO')) {
      const attributes = parseAttributes(line.substring(13));
      result.audioTracks.push({
        groupId: attributes['GROUP-ID'],
        name: attributes.NAME || 'Default Audio',
        language: attributes.LANGUAGE || 'und',
        isDefault: attributes.DEFAULT === 'YES',
        autoSelect: attributes.AUTOSELECT === 'YES',
        url: attributes.URI ? resolveUrl(attributes.URI, baseUrl) : null
      });
    }
    // Session Keys
    else if (line.startsWith('#EXT-X-SESSION-KEY:')) {
      const keyAttributes = parseAttributes(line.substring(19));
      result.sessionKeys.push({
        method: keyAttributes.METHOD,
        keyUri: keyAttributes.URI ? resolveUrl(keyAttributes.URI, baseUrl) : null,
        iv: keyAttributes.IV || null
      });
    }
  }

  // Sort qualities from highest to lowest
  result.variants.sort((a, b) => (b.height || 0) - (a.height || 0) || b.bandwidth - a.bandwidth);
  return result;
}

export function parseMediaPlaylist(lines, baseUrl) {
  if (typeof lines === 'string') {
    lines = lines.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  }

  const segments = [];
  let currentKey = null;
  let totalDuration = 0;
  let targetDuration = 10;
  let mediaSequence = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = parseFloat(line.split(':')[1]) || 10;
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = parseInt(line.split(':')[1], 10) || 0;
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributes(line.substring(11));
      currentKey = {
        method: attrs.METHOD, // AES-128, NONE, SAMPLE-AES
        keyUri: attrs.URI ? resolveUrl(attrs.URI, baseUrl) : null,
        iv: attrs.IV || null
      };
    } else if (line.startsWith('#EXTINF:')) {
      const durationStr = line.substring(8).split(',')[0];
      const duration = parseFloat(durationStr) || 0;
      totalDuration += duration;

      const nextLine = lines[i + 1];
      if (nextLine && !nextLine.startsWith('#')) {
        const segIndex = mediaSequence + segments.length;
        // IV derivation: if IV is not explicitly specified, RFC 8216 section 5.2 states
        // it is the sequence number as a big-endian 16-byte integer.
        let segmentIV = currentKey?.iv;
        if (currentKey && currentKey.method === 'AES-128' && !segmentIV) {
          segmentIV = sequenceToIV(segIndex);
        }

        segments.push({
          index: segIndex,
          url: resolveUrl(nextLine, baseUrl),
          duration: duration,
          key: currentKey ? { ...currentKey, iv: segmentIV } : null
        });
      }
    }
  }

  return {
    isMasterPlaylist: false,
    encryption: currentKey,
    targetDuration: targetDuration,
    totalDuration: totalDuration,
    totalSegments: segments.length,
    segments: segments
  };
}

function sequenceToIV(seq) {
  const buffer = new Uint8Array(16);
  const view = new DataView(buffer.buffer);
  view.setBigUint64(8, BigInt(seq));
  return '0x' + Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
}
