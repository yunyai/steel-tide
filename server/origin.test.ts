import { describe, expect, it } from 'vitest';
import { originAllowed } from './origin';

// Which pages may open the lobby socket. This keeps a page on the internet from driving the
// server through a captain's browser; it is not authentication.

describe('lobby socket origins', () => {
  it('lets in a request with no Origin (not a browser page) and the page the server served on a local name', () => {
    expect(originAllowed(undefined, '192.168.1.5:5173')).toBe(true);
    expect(originAllowed('http://192.168.1.5:5173', '192.168.1.5:5173')).toBe(true);
    expect(originAllowed('http://studio:5173', 'studio:5173')).toBe(true);
    expect(originAllowed('http://tide.local:5173', 'tide.local:5173')).toBe(true);
  });

  it('refuses a public name even when the Host header matches it (DNS rebinding)', () => {
    expect(originAllowed('http://game.example:5173', 'game.example:5173')).toBe(false);
    expect(originAllowed('https://evil.example', 'evil.example')).toBe(false);
  });

  it('lets in loopback, private and link-local addresses', () => {
    for (const o of [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://127.8.9.10',
      'http://[::1]:5173',
      'http://10.0.0.7:5173',
      'http://172.16.0.1',
      'http://172.31.255.255',
      'http://192.168.1.20:5173',
      'http://169.254.10.3',
      'http://[fd12:3456::1]:5173',
      'http://[fc00::1]',
      'http://[fe80::1]:5173',
    ]) expect(originAllowed(o, 'other:1'), o).toBe(true);
  });

  it('lets in local network names', () => {
    for (const o of ['http://macbook.local:5173', 'http://tide.lan', 'https://box.home.arpa:8443']) expect(originAllowed(o, 'other:1'), o).toBe(true);
  });

  it('refuses public addresses and names, and anything it cannot read', () => {
    for (const o of [
      'https://evil.example',
      'http://8.8.8.8',
      'http://172.32.0.1',
      'http://172.15.0.1',
      'http://192.169.0.1',
      'http://[2001:db8::1]',
      'http://local.evil.example',
      'http://evil.example.local.attacker.com',
      'http://localhost.evil.example',
      'null',
      'file://',
      'not a url',
      '',
    ]) expect(originAllowed(o, 'game.example:5173'), o).toBe(false);
  });

  it('does not take a lookalike for the same host', () => {
    expect(originAllowed('http://game.example.evil.com:5173', 'game.example:5173')).toBe(false);
    expect(originAllowed('http://game.example:5174', 'game.example:5173')).toBe(false);
  });
});
