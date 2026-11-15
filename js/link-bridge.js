/**
 * Multi-Transport Real-Time Link Bridge for Tabletop Sky Striker
 * Priority:
 *  1. BroadcastChannel (0ms same-browser preview / dual-window debug)
 *  2. Same-origin Native WebSocket `/ws` (2-5ms offline LAN via server.mjs)
 *  3. PeerJS WebRTC DataChannel fallback (public static hosting e.g. GitHub Pages / dreamger.com)
 */
(function (global) {
  'use strict';

  const PEERJS_CDNS = [
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
    'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'
  ];
  const PEER_PREFIX = 'yang-sky-striker-v1-';

  function randomRoomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 4; i++) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }

  class LinkBridge {
    constructor({ role, roomId, onMessage, onStatus }) {
      this.role = role; // 'host' | 'controller'
      this.roomId = (roomId || randomRoomCode()).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'SKY1';
      this.onMessage = onMessage || (() => {});
      this.onStatus = onStatus || (() => {});

      this.bc = null;
      this.ws = null;
      this.wsConnected = false;
      this.peer = null;
      this.peerConns = new Set();
      this.peerConnected = false;

      this.remoteConnected = false;
      this.lastSeenRemoteAt = 0;
      this.rttMs = null;
      this.transportName = '待连接';
      this._timers = [];
      this._destroyed = false;
    }

    start() {
      this._initBroadcastChannel();
      this._initWebSocket();
      this._startHeartbeat();
    }

    destroy() {
      this._destroyed = true;
      this._timers.forEach((id) => clearInterval(id));
      this._timers = [];
      if (this.bc) {
        try { this.bc.close(); } catch (_) {}
      }
      if (this.ws) {
        try { this.ws.close(); } catch (_) {}
      }
      if (this.peer) {
        try { this.peer.destroy(); } catch (_) {}
      }
    }

    _emitStatus() {
      const now = performance.now();
      const alive = this.lastSeenRemoteAt > 0 && (now - this.lastSeenRemoteAt < 4500);
      this.remoteConnected = alive;
      this.onStatus({
        connected: alive,
        roomId: this.roomId,
        transport: this.transportName,
        rttMs: this.rttMs
      });
    }

    _handleIncoming(packet, via) {
      if (!packet || packet.room !== this.roomId || packet.from === this.role) return;
      this.lastSeenRemoteAt = performance.now();
      this.transportName = via;

      if (packet.type === '__ping') {
        this._rawSend({ type: '__pong', ts: packet.ts });
        this._emitStatus();
        return;
      }
      if (packet.type === '__pong') {
        if (typeof packet.ts === 'number') {
          this.rttMs = Math.max(1, Math.round(performance.now() - packet.ts));
        }
        this._emitStatus();
        return;
      }
      if (packet.type === '__hello') {
        this._rawSend({ type: '__welcome', ts: performance.now() });
        this._emitStatus();
        return;
      }
      if (packet.type === '__welcome') {
        this._emitStatus();
        return;
      }

      if (!this.remoteConnected) this._emitStatus();
      this.onMessage(packet.type, packet.payload);
    }

    _rawSend(body) {
      const packet = {
        room: this.roomId,
        from: this.role,
        type: body.type,
        payload: body.payload,
        ts: body.ts
      };
      const json = JSON.stringify(packet);

      if (this.ws && this.wsConnected && this.ws.readyState === WebSocket.OPEN) {
        try { this.ws.send(json); } catch (_) {}
      }
      if (this.peerConns.size > 0) {
        for (const conn of this.peerConns) {
          if (conn.open) {
            try { conn.send(packet); } catch (_) {}
          }
        }
      }
      if (this.bc) {
        try { this.bc.postMessage(packet); } catch (_) {}
      }
    }

    send(type, payload = {}) {
      this._rawSend({ type, payload });
    }

    _initBroadcastChannel() {
      if (typeof BroadcastChannel === 'undefined') return;
      try {
        this.bc = new BroadcastChannel('sky-striker-' + this.roomId);
        this.bc.onmessage = (ev) => {
          this._handleIncoming(ev.data, '同机直连');
        };
        this.bc.postMessage({ room: this.roomId, from: this.role, type: '__hello' });
      } catch (_) {}
    }

    _initWebSocket() {
      if (
        typeof WebSocket === 'undefined' ||
        !global.location ||
        !/^https?:$/.test(global.location.protocol) ||
        /\.github\.io$/i.test(global.location.hostname || '')
      ) {
        this._initPeerFallback();
        return;
      }
      const proto = global.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${global.location.host}/ws?room=${encodeURIComponent(this.roomId)}&role=${encodeURIComponent(this.role)}`;

      let openedOnce = false;
      try {
        const ws = new WebSocket(url);
        this.ws = ws;

        const fallbackTimer = setTimeout(() => {
          if (!openedOnce && !this._destroyed) {
            this._initPeerFallback();
          }
        }, 1400);

        ws.onopen = () => {
          openedOnce = true;
          clearTimeout(fallbackTimer);
          this.wsConnected = true;
          this._rawSend({ type: '__hello' });
          this._emitStatus();
        };

        ws.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data);
            if (data && data.type === '__peer_joined') {
              this._rawSend({ type: '__hello' });
              return;
            }
            this._handleIncoming(data, '局域网高速');
          } catch (_) {}
        };

        ws.onerror = () => {
          if (!openedOnce) this._initPeerFallback();
        };

        ws.onclose = () => {
          this.wsConnected = false;
          if (!this._destroyed) {
            if (openedOnce) {
              setTimeout(() => {
                if (!this._destroyed) this._initWebSocket();
              }, 1500);
            } else {
              this._initPeerFallback();
            }
          }
        };
      } catch (_) {
        this._initPeerFallback();
      }
    }

    _loadPeerScript(cdnIdx = 0) {
      if (global.Peer) return Promise.resolve(global.Peer);
      if (cdnIdx >= PEERJS_CDNS.length) return Promise.reject(new Error('PeerJS CDN unavailable'));
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = PEERJS_CDNS[cdnIdx];
        s.async = true;
        s.dataset.peerjs = '1';
        s.onload = () => (global.Peer ? resolve(global.Peer) : this._loadPeerScript(cdnIdx + 1).then(resolve, reject));
        s.onerror = () => {
          s.remove();
          this._loadPeerScript(cdnIdx + 1).then(resolve, reject);
        };
        document.head.appendChild(s);
      });
    }

    _initPeerFallback() {
      if (this.peer || this._destroyed) return;
      this._loadPeerScript()
        .then((PeerClass) => {
          if (!PeerClass || this._destroyed || this.wsConnected) return;
          const hostPeerId = PEER_PREFIX + this.roomId;
          const myId = this.role === 'host' ? hostPeerId : undefined;
          const peer = new PeerClass(myId, { debug: 0 });
          this.peer = peer;

          const connectToHost = () => {
            if (this._destroyed || this.wsConnected || this.remoteConnected || !peer.open) return;
            for (const c of this.peerConns) {
              if (c.open) return;
            }
            const conn = peer.connect(hostPeerId, { reliable: true });
            this._bindPeerConn(conn);
          };

          peer.on('open', () => {
            if (this.role === 'controller') {
              connectToHost();
              const retryId = setInterval(connectToHost, 2600);
              this._timers.push(retryId);
            }
          });

          peer.on('connection', (conn) => {
            this._bindPeerConn(conn);
          });

          peer.on('disconnected', () => {
            if (!this._destroyed && !peer.destroyed) {
              try { peer.reconnect(); } catch (_) {}
            }
          });

          peer.on('error', () => {});
        })
        .catch(() => {});
    }

    _bindPeerConn(conn) {
      conn.on('open', () => {
        this.peerConns.add(conn);
        this.peerConnected = true;
        this._rawSend({ type: '__hello' });
      });
      conn.on('data', (data) => {
        const packet = typeof data === 'string' ? JSON.parse(data) : data;
        this._handleIncoming(packet, 'WebRTC直连');
      });
      conn.on('close', () => {
        this.peerConns.delete(conn);
      });
    }

    _startHeartbeat() {
      const t = setInterval(() => {
        if (this._destroyed) return;
        this._rawSend({ type: '__ping', ts: performance.now() });
        this._emitStatus();
      }, 1000);
      this._timers.push(t);
    }
  }

  global.LinkBridge = LinkBridge;
  global.randomRoomCode = randomRoomCode;
})(typeof window !== 'undefined' ? window : globalThis);
