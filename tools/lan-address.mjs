/**
 * Print the address a phone on the same wifi should be pointed at.
 *
 * The relay binds 0.0.0.0 and the game derives its default relay URL from
 * `location.hostname` — which inside a packaged app is `localhost`, i.e. the
 * phone itself, i.e. nothing. So on iOS the address has to be typed in by hand
 * on the 설정 screen, and the one thing standing between "typed in by hand" and
 * "typed in wrong" is knowing what to type.
 *
 * Run by `npm run server:lan` immediately before the relay starts.
 */
import { networkInterfaces } from 'node:os';
import { DEFAULT_PORT } from '../src/net/Transport.js';

/**
 * Every non-loopback IPv4 this machine answers on.
 *
 * IPv4 only, deliberately: the address is going to be typed into a text field on
 * a phone, and an IPv6 address is not something anyone types twice. `internal`
 * filters the loopback; the rest are real interfaces, and on a laptop that is
 * usually wifi plus whatever virtual adapters Docker or a VPN has left behind —
 * which is why they are all printed rather than one being guessed at.
 */
function addresses() {
  const out = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      out.push({ name, address: net.address });
    }
  }
  return out;
}

const found = addresses();

if (!found.length) {
  console.log('\n  이 기계에 외부 IPv4 주소가 없다. 와이파이에 연결되어 있는지 확인해라.\n');
} else {
  console.log('\n  ── 아이폰 설정 → 서버 주소 에 입력할 값 ─────────────────────────');
  for (const { name, address } of found) {
    console.log(`     ws://${address}:${DEFAULT_PORT}     (${name})`);
  }
  console.log(
    '\n  둘 이상이면 보통 en0 (와이파이) 이다. 폰과 맥이 같은 네트워크에\n' +
      '  있어야 하고, 맥의 방화벽이 들어오는 연결을 막고 있으면 안 된다.\n',
  );
}
