// ─────────────────────────────────────────────────────────────────────────────
// test-webui.ts — arc web UI automated test
//
// Tests: HTTP endpoint, WebSocket upgrade, ping/pong, send/response flow.
// Run: node dist/test-webui.js [--port 7070]
//
// Exit 0 = all pass. Exit 1 = failure (with details).
// ─────────────────────────────────────────────────────────────────────────────

import * as http   from 'http';
import * as crypto from 'crypto';
import * as net    from 'net';

const PORT = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] ?? '7070');
const HOST = 'localhost';

// Colours
const GR = '\x1b[38;2;134;239;172m';
const RE = '\x1b[38;2;248;113;113m';
const SD = '\x1b[38;2;100;116;139m';
const V  = '\x1b[38;2;139;92;246m';
const R  = '\x1b[0m';

let passed = 0;
let failed = 0;

function ok(label: string)   { console.log(`  ${GR}✓${R}  ${label}`); passed++; }
function fail(label: string, detail = '') {
  console.log(`  ${RE}✗${R}  ${label}${detail ? '\n      ' + SD + detail + R : ''}`);
  failed++;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpGet(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: HOST, port: PORT, path, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c: string) => body += c);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── WebSocket client ──────────────────────────────────────────────────────────

function wsEncode(data: string): Buffer {
  const payload = Buffer.from(data, 'utf8');
  const len = payload.length;
  const mask = crypto.randomBytes(4);
  const header = len < 126
    ? Buffer.from([0x81, 0x80 | len])
    : Buffer.from([0x81, 0xFE, len >> 8, len & 0xFF]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function wsDecode(buf: Buffer): string | null {
  if (buf.length < 2) return null;
  const len = buf[1] & 0x7f;
  const offset = len === 126 ? 4 : 2;
  if (buf.length < offset + len) return null;
  return buf.slice(offset, offset + len).toString('utf8');
}

function connectWS(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const key    = crypto.randomBytes(16).toString('base64');
    const accept = crypto.createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');

    const socket = net.createConnection(PORT, HOST);
    socket.setTimeout(8000);

    socket.write(
      `GET /ws HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\n` +
      `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
    );

    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const headers = buf.toString();
      if (headers.includes('\r\n\r\n')) {
        if (headers.includes('101') && headers.includes(accept)) {
          socket.removeListener('data', onData);
          resolve(socket);
        } else {
          reject(new Error('WS handshake failed: ' + headers.slice(0, 100)));
        }
      }
    };

    socket.on('data', onData);
    socket.on('error', reject);
    socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
  });
}

function wsRecv(socket: net.Socket, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error('recv timeout')), timeout);

    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const msg = wsDecode(buf);
      if (msg !== null) {
        clearTimeout(timer);
        socket.removeListener('data', onData);
        try { resolve(JSON.parse(msg)); }
        catch { resolve(msg); }
      }
    };
    socket.on('data', onData);
    socket.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  console.log();
  console.log(`${V}◈ arc web UI test${R}  ${SD}http://localhost:${PORT}${R}`);
  console.log();

  // Test 1: HTTP root responds
  try {
    const { status, body } = await httpGet('/');
    if (status === 200 && body.includes('arc')) ok('HTTP / returns 200 with arc content');
    else fail('HTTP / response', `status=${status}, body=${body.slice(0,80)}`);
  } catch (e: any) {
    fail('HTTP / reachable', e.message);
    console.log(`\n  ${SD}Is arc serve running? Try: ${V}arc serve${R}\n`);
    process.exit(1);
  }

  // Test 2: 404 for unknown paths
  try {
    const { status } = await httpGet('/nonexistent');
    if (status === 404) ok('HTTP 404 for unknown paths');
    else fail('HTTP 404', `got status ${status}`);
  } catch (e: any) { fail('HTTP 404 test', e.message); }

  // Test 3: WebSocket upgrade
  let socket: net.Socket | null = null;
  try {
    socket = await connectWS();
    ok('WebSocket upgrade (101 Switching Protocols)');
  } catch (e: any) {
    fail('WebSocket upgrade', e.message);
    process.exit(1);
  }

  // Test 4: Ping/pong
  try {
    socket!.write(wsEncode(JSON.stringify({ type: 'ping' })));
    const pong = await wsRecv(socket!, 3000);
    if (pong?.type === 'pong') ok(`Ping/pong roundtrip (latency: ~${Date.now() - (pong.ts ?? Date.now())}ms)`);
    else fail('Ping/pong', `got: ${JSON.stringify(pong)}`);
  } catch (e: any) { fail('Ping/pong', e.message); }

  // Test 5: Clear command (no crash)
  try {
    socket!.write(wsEncode(JSON.stringify({ type: 'clear' })));
    // No response expected — just verify it doesn't crash the server
    await new Promise(r => setTimeout(r, 200));
    // Send ping to verify server is still alive
    socket!.write(wsEncode(JSON.stringify({ type: 'ping' })));
    const pong = await wsRecv(socket!, 2000);
    if (pong?.type === 'pong') ok('Clear command (server stays alive)');
    else fail('Clear command', 'server did not respond to follow-up ping');
  } catch (e: any) { fail('Clear command', e.message); }

  // Test 6: Send with invalid model (should get error, not hang)
  try {
    socket!.write(wsEncode(JSON.stringify({
      type: 'chat',
      model: 'invalid_backend::nonexistent_model',
      text: 'hello',
    })));
    const resp = await wsRecv(socket!, 5000);
    if (resp?.type === 'error') ok(`Invalid model returns error (not hang): "${resp.error?.slice(0,40)}…"`);
    else if (resp?.type === 'done') ok('Send completed (model found)');
    else fail('Send with invalid model', `got: ${JSON.stringify(resp)?.slice(0,80)}`);
  } catch (e: any) { fail('Send with invalid model', e.message); }

  // Test 7: Second ping after send (connection still healthy)
  try {
    socket!.write(wsEncode(JSON.stringify({ type: 'ping' })));
    const pong = await wsRecv(socket!, 2000);
    if (pong?.type === 'pong') ok('Connection healthy after send');
    else fail('Post-send health check', `got: ${JSON.stringify(pong)}`);
  } catch (e: any) { fail('Post-send health check', e.message); }

  socket?.destroy();

  // Summary
  console.log();
  console.log(`  ${SD}${'─'.repeat(40)}${R}`);
  const total = passed + failed;
  if (failed === 0) {
    console.log(`  ${GR}All ${total} tests passed.${R}  Web UI is healthy.\n`);
  } else {
    console.log(`  ${GR}${passed} passed${R}  ${RE}${failed} failed${R}  of ${total} total\n`);
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error(`\n${RE}Fatal:${R}`, e.message);
  process.exit(1);
});
