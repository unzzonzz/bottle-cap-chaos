/**
 * The furniture `jsc` does not come with.
 *
 * ── a separate module because ESM hoists imports ────────────────────────────
 * These have to be installed before any other module is evaluated:
 * `config.js` calls `structuredClone` at module scope, so by the time an entry
 * file's own statements run it is already too late. Import declarations are
 * hoisted and evaluated depth-first in source order, so the only way to run code
 * before a sibling import is to BE an import, listed first.
 *
 * ── none of these touch arithmetic ─────────────────────────────────────────
 * Deliberately. This file exists to let the check run under a second engine, and
 * anything here that could round a number differently would be a difference
 * between the two runs contributed by the harness rather than by the engine —
 * which would invalidate the only thing being measured. Strings, logging, and a
 * clone of plain data. Nothing else.
 */

/* eslint-disable no-undef */

if (typeof globalThis.console === 'undefined') {
  const say = (...args) =>
    print(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  globalThis.console = { log: say, warn: say, error: say, info: say, debug: say };
}

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = class TextDecoder {
    decode(bytes) {
      if (!bytes) return '';
      const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      let out = '';
      for (let i = 0; i < b.length; ) {
        const c = b[i++];
        if (c < 0x80) out += String.fromCharCode(c);
        else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
        else if (c < 0xf0)
          out += String.fromCharCode(((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
        else {
          const cp =
            ((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
          const v = cp - 0x10000;
          out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
        }
      }
      return out;
    }
  };
}

if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = class TextEncoder {
    encode(str) {
      const out = [];
      for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
          c = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
        }
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
        else if (c < 0x10000)
          out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        else
          out.push(
            0xf0 | (c >> 18),
            0x80 | ((c >> 12) & 0x3f),
            0x80 | ((c >> 6) & 0x3f),
            0x80 | (c & 0x3f),
          );
      }
      return new Uint8Array(out);
    }
    encodeInto(str, dest) {
      const bytes = this.encode(str);
      dest.set(bytes);
      return { read: str.length, written: bytes.length };
    }
  };
}

// `CONFIG` is plain JSON data — numbers, strings, booleans, arrays, objects — so
// a JSON round trip clones it exactly. It is not a general structuredClone and
// does not need to be.
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));
}
