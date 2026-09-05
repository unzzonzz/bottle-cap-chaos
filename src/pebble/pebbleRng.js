/**
 * 같은 시드의 판을 다시 찍기 위한 난수다. 시간이나 호출 순서를 섞지 않는다.
 * boardTexture.hash2의 정수 곱·비트 섞기를 그대로 쓰되, 2^32로 나눠 1을
 * 제외한다. 채널을 따로 받으므로 색 슬라이더가 형태의 난수 순서를 밀지 않는다.
 */
export function pebbleRng(seed, channel) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ channel, 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
