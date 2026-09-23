import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandCidr,
  expandCidrRanges,
  intToIpv4,
  ipv4ToInt,
  isIpv4InCidr,
  isPrivateIpv4,
  MAX_EXPANDED_ADDRESSES,
  parseCidr,
} from './ipv4.js';

describe('ipv4ToInt', () => {
  it('parses a dotted quad', () => {
    assert.equal(ipv4ToInt('0.0.0.0'), 0);
    assert.equal(ipv4ToInt('255.255.255.255'), 4_294_967_295);
    assert.equal(ipv4ToInt('192.168.1.1'), 3_232_235_777);
  });

  it('rejects anything that is not four plain decimal octets', () => {
    for (const bad of [
      '',
      '1.2.3',
      '1.2.3.4.5',
      '1.2.3.256',
      '1.2.3.-1',
      '0x1.2.3.4',
      '1.2.3. 4',
      '1e2.0.0.1',
      '1.2.3.',
    ]) {
      assert.equal(ipv4ToInt(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });

  it('round-trips through intToIpv4', () => {
    for (const ip of ['10.0.0.1', '172.16.31.255', '8.8.8.8']) {
      assert.equal(intToIpv4(ipv4ToInt(ip)!), ip);
    }
  });
});

describe('parseCidr', () => {
  // Regression: `1 << hostBits` coerces to a signed 32-bit int, so `1 << 31`
  // is negative. A /1 scope therefore computed a negative usable size and
  // expanded to ZERO addresses, which SAFE-08's preview reported as a
  // legitimate plan rather than as the arithmetic failure it was.
  it('computes a positive size for prefixes with more than 30 host bits', () => {
    assert.equal(parseCidr('0.0.0.0/1')!.size, 2_147_483_648);
    assert.equal(parseCidr('0.0.0.0/0')!.size, 4_294_967_296);
    assert.equal(parseCidr('10.0.0.0/8')!.size, 16_777_216);
  });

  it('masks the base address down to the network address', () => {
    assert.equal(intToIpv4(parseCidr('192.168.1.77/24')!.network), '192.168.1.0');
  });

  it('rejects malformed input', () => {
    for (const bad of ['10.0.0.0', '10.0.0.0/33', '10.0.0.0/', '10.0.0.0/x', 'nope/24']) {
      assert.equal(parseCidr(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });
});

describe('isIpv4InCidr', () => {
  it('matches inside and rejects outside', () => {
    assert.equal(isIpv4InCidr('192.168.1.55', '192.168.1.0/24'), true);
    assert.equal(isIpv4InCidr('192.168.2.55', '192.168.1.0/24'), false);
    assert.equal(isIpv4InCidr('10.1.2.3', '10.0.0.0/8'), true);
    assert.equal(isIpv4InCidr('11.1.2.3', '10.0.0.0/8'), false);
  });

  it('handles the /0 and /32 edges', () => {
    assert.equal(isIpv4InCidr('8.8.8.8', '0.0.0.0/0'), true);
    assert.equal(isIpv4InCidr('8.8.8.8', '8.8.8.8/32'), true);
    assert.equal(isIpv4InCidr('8.8.8.9', '8.8.8.8/32'), false);
  });

  it('agrees with expandCidr over a small range', () => {
    const { addresses } = expandCidr('192.168.4.0/29');
    for (const address of addresses) assert.equal(isIpv4InCidr(address, '192.168.4.0/29'), true);
    assert.equal(isIpv4InCidr('192.168.4.8', '192.168.4.0/29'), false);
  });

  it('returns false rather than throwing on junk', () => {
    assert.equal(isIpv4InCidr('junk', '10.0.0.0/8'), false);
    assert.equal(isIpv4InCidr('10.0.0.1', 'junk'), false);
  });
});

describe('expandCidr', () => {
  it('excludes network and broadcast below /31', () => {
    assert.deepEqual(expandCidr('192.168.0.0/30').addresses, ['192.168.0.1', '192.168.0.2']);
  });

  it('includes every address at /31 and /32', () => {
    assert.deepEqual(expandCidr('192.168.0.0/31').addresses, ['192.168.0.0', '192.168.0.1']);
    assert.deepEqual(expandCidr('192.168.0.7/32').addresses, ['192.168.0.7']);
  });

  it('caps and reports truncation rather than materialising an unbounded list', () => {
    const wide = expandCidr('10.0.0.0/8');
    assert.equal(wide.truncated, true);
    assert.equal(wide.addresses.length, MAX_EXPANDED_ADDRESSES);
  });

  it('caps a /1 instead of returning nothing', () => {
    const half = expandCidr('0.0.0.0/1');
    assert.equal(half.truncated, true);
    assert.equal(half.addresses.length, MAX_EXPANDED_ADDRESSES);
  });

  it('deduplicates across overlapping ranges', () => {
    const { addresses } = expandCidrRanges(['192.168.0.0/30', '192.168.0.0/29']);
    assert.equal(new Set(addresses).size, addresses.length);
    assert.equal(addresses.length, 6);
  });
});

describe('isPrivateIpv4', () => {
  it('classifies RFC1918 and loopback as private', () => {
    for (const ip of ['10.1.1.1', '172.16.0.1', '172.31.255.254', '192.168.1.1', '127.0.0.1']) {
      assert.equal(isPrivateIpv4(ip), true, ip);
    }
  });

  it('does not over-claim 172.32/172.15 as private', () => {
    for (const ip of ['172.15.0.1', '172.32.0.1', '8.8.8.8', '203.0.113.1']) {
      assert.equal(isPrivateIpv4(ip), false, ip);
    }
  });
});
