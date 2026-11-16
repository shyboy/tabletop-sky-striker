/**
 * Zero-Dependency Local LAN HTTP + HTTPS + Native WebSocket Server
 * Powers Tabletop Sky Striker with <3ms LAN latency and optional HTTPS for iOS/Android Gyro + Mic.
 */
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTTP_PORT = Number(process.env.PORT || 8780);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || (HTTP_PORT + 1));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

// ---------------- 1. Smart LAN IPv4 Detection (filters out TUN/Proxy/WSL virtual adapters) ----------------
function detectLanIPs() {
  const nets = os.networkInterfaces();
  const candidates = [];

  for (const [name, list] of Object.entries(nets)) {
    if (!list) continue;
    const lower = name.toLowerCase();
    const isVirtual = /meta|clash|mihomo|tun|tap|wsl|vethernet|docker|vmware|vbox|loopback/i.test(lower);

    for (const info of list) {
      if (info.family !== 'IPv4' || info.internal) continue;
      const ip = info.address;
      if (ip.startsWith('169.254.') || ip.startsWith('198.18.')) continue;

      let priority = isVirtual ? 10 : 50;
      if (!isVirtual && (/wlan|wi-fi|wifi/i.test(lower))) priority = 100;
      else if (!isVirtual && (/eth|以太网|本地连接/i.test(lower))) priority = 90;
      if (ip.startsWith('192.168.')) priority += 5;

      candidates.push({ name, ip, priority });
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates;
}

// ---------------- 2. Pure Node.js ASN.1 DER Self-Signed X.509 v3 Certificate Generator ----------------
function derLen(len) {
  if (len < 128) return Buffer.from([len]);
  const bytes = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTag(tag, content) {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}

function derSeq(...items) {
  return derTag(0x30, Buffer.concat(items));
}

function derSet(...items) {
  return derTag(0x31, Buffer.concat(items));
}

function derOid(oidStr) {
  const parts = oidStr.split('.').map(Number);
  const out = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    if (v === 0) {
      out.push(0);
      continue;
    }
    const stack = [];
    while (v > 0) {
      stack.unshift(v & 0x7f);
      v >>>= 7;
    }
    for (let j = 0; j < stack.length - 1; j++) stack[j] |= 0x80;
    out.push(...stack);
  }
  return derTag(0x06, Buffer.from(out));
}

function derInt(buf) {
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from([buf]);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0x00]), b]);
  return derTag(0x02, b);
}

function derUtf8(str) {
  return derTag(0x0c, Buffer.from(str, 'utf8'));
}

function derUtcTime(dateStr) {
  return derTag(0x17, Buffer.from(dateStr, 'ascii'));
}

function derBitString(buf) {
  return derTag(0x03, Buffer.concat([Buffer.from([0x00]), buf]));
}

function generateSelfSignedCert(ipList) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  // sha256WithRSAEncryption (1.2.840.113549.1.1.11) + NULL
  const sigAlg = derSeq(derOid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00]));

  // Issuer & Subject: CN=SkyStriker-LAN
  const rdnCN = derSet(derSeq(derOid('2.5.4.3'), derUtf8('SkyStriker-LAN')));
  const nameSeq = derSeq(rdnCN);

  // Validity: 2025-01-01 to 2036-12-31
  const validity = derSeq(derUtcTime('250101000000Z'), derUtcTime('361231235959Z'));

  // SAN Extension: DNS:localhost + IP:127.0.0.1 + LAN IPs
  const sanEntries = [
    derTag(0x82, Buffer.from('localhost', 'ascii')),
    derTag(0x87, Buffer.from([127, 0, 0, 1]))
  ];
  for (const item of ipList) {
    const octets = item.ip.split('.').map(Number);
    if (octets.length === 4 && octets.every((n) => n >= 0 && n <= 255)) {
      sanEntries.push(derTag(0x87, Buffer.from(octets)));
    }
  }
  const sanExtValue = derTag(0x04, derSeq(...sanEntries));
  const sanExt = derSeq(derOid('2.5.29.17'), sanExtValue);
  const v3Exts = derTag(0xa3, derSeq(sanExt));

  const versionV3 = derTag(0xa0, derInt(2));
  const serial = derInt(crypto.randomBytes(8));

  const tbsCert = derSeq(
    versionV3,
    serial,
    sigAlg,
    nameSeq,
    validity,
    nameSeq,
    spkiDer,
    v3Exts
  );

  const signature = crypto.sign('sha256', tbsCert, privateKey);
  const fullCertDer = derSeq(tbsCert, sigAlg, derBitString(signature));
  const b64 = fullCertDer.toString('base64').match(/.{1,64}/g).join('\n');
  const certPem = `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;

  return { key: keyPem, cert: certPem };
}

// ---------------- 3. Ultra-Fast Native RFC 6455 WebSocket Room Relay ----------------
// One room = one (or more) 'host' sockets + any number of client sockets ('controller', 'crew', ...).
// Star relay: host -> every client, client -> host(s) only. Clients never hear each other, so a
// pilot phone and a ground-crew phone can share a room without cross-talk.
const rooms = new Map(); // roomId -> Set<Socket>   (socket.skyRole = 'host' | 'controller' | 'crew' | ...)

function shouldRelay(fromSocket, toSocket) {
  if (fromSocket === toSocket || toSocket.destroyed) return false;
  return (fromSocket.skyRole === 'host') !== (toSocket.skyRole === 'host');
}

function encodeWsTextFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function attachWebSocketRelay(server) {
  server.on('upgrade', (req, socket) => {
    const reqUrl = new URL(req.url || '/', 'http://localhost');
    if (reqUrl.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const wsKey = req.headers['sec-websocket-key'];
    if (!wsKey) {
      socket.destroy();
      return;
    }

    const accept = crypto
      .createHash('sha1')
      .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.setNoDelay(true);

    const roomId = (reqUrl.searchParams.get('room') || 'SKY1').toUpperCase();
    socket.skyRole = (reqUrl.searchParams.get('role') || 'controller').toLowerCase().slice(0, 24);
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    const peers = rooms.get(roomId);
    peers.add(socket);

    // Notify existing peers in the room immediately
    const joinNotice = encodeWsTextFrame(JSON.stringify({ room: roomId, type: '__peer_joined' }));
    for (const peer of peers) {
      if (shouldRelay(socket, peer)) peer.write(joinNotice);
    }

    let recvBuf = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      recvBuf = Buffer.concat([recvBuf, chunk]);

      while (recvBuf.length >= 2) {
        const b0 = recvBuf[0];
        const b1 = recvBuf[1];
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let payloadLen = b1 & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
          if (recvBuf.length < 4) return;
          payloadLen = recvBuf.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (recvBuf.length < 10) return;
          payloadLen = Number(recvBuf.readBigUInt64BE(2));
          offset = 10;
        }

        const maskBytes = masked ? 4 : 0;
        const frameTotal = offset + maskBytes + payloadLen;
        if (recvBuf.length < frameTotal) return;

        let data = recvBuf.subarray(offset + maskBytes, frameTotal);
        if (masked) {
          const mask = recvBuf.subarray(offset, offset + 4);
          const unmasked = Buffer.allocUnsafe(payloadLen);
          for (let i = 0; i < payloadLen; i++) {
            unmasked[i] = data[i] ^ mask[i & 3];
          }
          data = unmasked;
        }
        recvBuf = recvBuf.subarray(frameTotal);

        if (opcode === 0x8) {
          // Close frame
          socket.end(Buffer.from([0x88, 0x00]));
          return;
        } else if (opcode === 0x9) {
          // Ping -> Pong
          socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data]));
        } else if (opcode === 0x1) {
          // Relay text message across the host <-> clients star of this room
          const outFrame = encodeWsTextFrame(data.toString('utf8'));
          for (const peer of peers) {
            if (shouldRelay(socket, peer)) {
              peer.write(outFrame);
            }
          }
        }
      }
    });

    const cleanup = () => {
      peers.delete(socket);
      if (peers.size === 0) rooms.delete(roomId);
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });
}

// ---------------- 4. Static File & Network Info Handler ----------------
let httpsEnabled = false;

function handleRequest(req, res) {
  const reqUrl = new URL(req.url || '/', 'http://localhost');

  if (reqUrl.pathname === '/api/network-info') {
    const ips = detectLanIPs();
    const endpoints = [];
    for (const item of ips) {
      endpoints.push({
        origin: `http://${item.ip}:${HTTP_PORT}`,
        label: `⚡ 极速直连 HTTP (${item.ip} · ${item.name})`
      });
      if (httpsEnabled) {
        endpoints.push({
          origin: `https://${item.ip}:${HTTPS_PORT}`,
          label: `🧭 传感器增强 HTTPS (${item.ip} · 解锁陀螺仪/真吹气)`
        });
      }
    }
    if (endpoints.length === 0) {
      endpoints.push({ origin: `http://localhost:${HTTP_PORT}`, label: `本机预览 (localhost:${HTTP_PORT})` });
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ httpPort: HTTP_PORT, httpsPort: HTTPS_PORT, httpsEnabled, endpoints }));
    return;
  }

  let relPath = decodeURIComponent(reqUrl.pathname);
  if (relPath === '/') relPath = '/index.html';

  const safePath = path.normalize(path.join(__dirname, relPath));
  if (!safePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(safePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(safePath).pipe(res);
  });
}

const lanList = detectLanIPs();
const httpServer = http.createServer(handleRequest);
attachWebSocketRelay(httpServer);

httpServer.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.log(`  ℹ️  端口 ${HTTP_PORT} 已在运行中，直接刷新浏览器 http://localhost:${HTTP_PORT} 即可畅玩！`);
    process.exit(0);
  }
  console.error(err);
});

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  const primaryIp = lanList[0]?.ip || 'localhost';
  console.log('======================================================');
  console.log('  ✈️  桌面飞机大战 · 局域网双屏服务器已启动');
  console.log(`  🖥  电脑/平板大屏入口: http://localhost:${HTTP_PORT}`);
  console.log(`  📱 手机扫码局域网入口: http://${primaryIp}:${HTTP_PORT}/controller.html`);
  if (httpsEnabled) {
    console.log(`  🧭 陀螺仪/吹气增强入口: https://${primaryIp}:${HTTPS_PORT}/controller.html`);
  }
  console.log('======================================================');
});

try {
  const creds = generateSelfSignedCert(lanList);
  const httpsServer = https.createServer(creds, handleRequest);
  attachWebSocketRelay(httpsServer);
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    httpsEnabled = true;
    const primaryIp = lanList[0]?.ip || 'localhost';
    console.log(`  🧭 陀螺仪/吹气增强入口: https://${primaryIp}:${HTTPS_PORT}/controller.html`);
  });
  httpsServer.on('error', () => {
    httpsEnabled = false;
  });
} catch (err) {
  httpsEnabled = false;
}
