/**
 * Multi-Transport Real-Time Link Bridge for Tabletop Sky Striker
 * Priority:
 *  1. BroadcastChannel (0ms same-browser preview / dual-window debug)
 *  2. Same-origin Native WebSocket `/ws` (2-5ms offline LAN via server.mjs)
 *  3. PeerJS WebRTC DataChannel fallback (public static hosting e.g. GitHub Pages / dreamger.com)
 *
 * Topology: one 'host' (tablet) + any number of non-host clients per room, e.g. the pilot's
 * 'controller' phone and a parent's 'crew' phone at the same time. It is a star: clients only
 * ever listen to the host, the host listens to every client and tracks liveness per role.
 */
(function (global) {
  'use strict';

  const PEERJS_CDNS = [
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
    'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'
  ];
  const PEER_PREFIX = 'yang-sky-striker-v1-';
  const TRANSPORT_ORDER = ['同机直连', '局域网高速', 'WebRTC直连']; // fastest first

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
      this.role = role || 'controller'; // 'host' | 'controller' | 'crew' (any non-host role is a client)
      this.isHost = this.role === 'host';
      // Unique per page instance: lets pongs be addressed and duplicates (same packet arriving
      // over two transports at once) be dropped.
      this.cid = this.role + '-' + Math.random().toString(36).slice(2, 10);
      this._seq = 0;
      this._seenSeq = new Map(); // sender cid -> highest app-message seq delivered
      this._viaSeen = {}; // transport label -> last packet timestamp
      this._roleSeen = new Map(); // (host only) client role -> last seen timestamp
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
      if (!this._destroyed) this._rawSend({ type: '__bye' });
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
      const roles = this.connectedRoles();
      this.onStatus({
        connected: alive,
        roomId: this.roomId,
        transport: this.transportName,
        rttMs: this.rttMs,
        // Host: which client roles are alive right now, e.g. ['controller', 'crew'].
        // Client: ['host'] when linked, [] otherwise.
        roles,
        controllerConnected: roles.indexOf('controller') !== -1,
        crewConnected: roles.indexOf('crew') !== -1
      });
    }

    connectedRoles() {
      const now = performance.now();
      if (!this.isHost) {
        return this.lastSeenRemoteAt > 0 && now - this.lastSeenRemoteAt < 4500 ? ['host'] : [];
      }
      const out = [];
      for (const [role, at] of this._roleSeen) {
        if (now - at < 4500) out.push(role);
      }
      return out;
    }

    isRoleConnected(role) {
      return this.connectedRoles().indexOf(role) !== -1;
    }

    _handleIncoming(packet, via) {
      if (!packet || packet.room !== this.roomId || !packet.from) return;
      if (packet.cid && packet.cid === this.cid) return;
      // Star topology: clients only hear the host, the host only hears clients. Shared media
      // (BroadcastChannel) would otherwise leak controller <-> crew traffic into each other.
      if (this.isHost ? packet.from === 'host' : packet.from !== 'host') return;
      // Addressed packets (pong / welcome) are for one page instance only.
      if (packet.to && packet.to !== this.cid) return;

      const now = performance.now();
      this.lastSeenRemoteAt = now;
      if (this.isHost) this._roleSeen.set(packet.from, now);
      // With several clients the label would flip between their transports; show the pilot's.
      const labelOwner = !this.isHost || packet.from === 'controller' || !this.isRoleConnected('controller');
      if (labelOwner) {
        // The same peer is often reachable over two transports at once (same-browser preview:
        // BroadcastChannel + WebSocket). Report the fastest live one instead of whichever
        // packet happened to arrive last, so the status label does not flicker.
        this._viaSeen[via] = now;
        const rank = TRANSPORT_ORDER.indexOf(via);
        const curRank = TRANSPORT_ORDER.indexOf(this.transportName);
        const curAlive = curRank !== -1 && now - (this._viaSeen[this.transportName] || 0) < 3000;
        if (!curAlive || rank <= curRank) this.transportName = via;
      }

      if (packet.type === '__ping') {
        this._rawSend({ type: '__pong', ts: packet.ts, to: packet.cid });
        this._emitStatus();
        return;
      }
      if (packet.type === '__pong') {
        // On the host, the displayed latency is the pilot's whenever a controller is linked.
        const rttOwner = !this.isHost || packet.from === 'controller' || !this.isRoleConnected('controller');
        if (typeof packet.ts === 'number' && rttOwner) {
          this.rttMs = Math.max(1, Math.round(performance.now() - packet.ts));
        }
        this._emitStatus();
        return;
      }
      if (packet.type === '__hello') {
        this._rawSend({ type: '__welcome', ts: performance.now(), to: packet.cid });
        this._emitStatus();
        return;
      }
      if (packet.type === '__welcome') {
        this._emitStatus();
        return;
      }
      if (packet.type === '__bye') {
        // A client page closed: drop that role right away instead of waiting for the timeout.
        // Any sibling of the same role re-registers with its next ping (<= 1s).
        if (this.isHost) {
          this._roleSeen.delete(packet.from);
          if (this._roleSeen.size === 0) this.lastSeenRemoteAt = 0;
        } else {
          this.lastSeenRemoteAt = 0;
        }
        this._emitStatus();
        return;
      }

      // The same packet can arrive over two transports (e.g. BroadcastChannel + WebSocket):
      // deliver each application message exactly once.
      if (packet.cid && typeof packet.n === 'number') {
        const last = this._seenSeq.get(packet.cid);
        if (last !== undefined && packet.n <= last) return;
        this._seenSeq.set(packet.cid, packet.n);
      }

      if (!this.remoteConnected) this._emitStatus();
      this.onMessage(packet.type, packet.payload, { from: packet.from, cid: packet.cid, via });
    }

    _rawSend(body) {
      const packet = {
        room: this.roomId,
        from: this.role,
        cid: this.cid,
        type: body.type,
        payload: body.payload,
        ts: body.ts
      };
      if (body.to) packet.to = body.to;
      if (typeof body.n === 'number') packet.n = body.n;
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
      this._rawSend({ type, payload, n: ++this._seq });
    }

    _initBroadcastChannel() {
      if (typeof BroadcastChannel === 'undefined') return;
      try {
        this.bc = new BroadcastChannel('sky-striker-' + this.roomId);
        this.bc.onmessage = (ev) => {
          this._handleIncoming(ev.data, '同机直连');
        };
        this.bc.postMessage({ room: this.roomId, from: this.role, cid: this.cid, type: '__hello' });
      } catch (_) {}
      // Tell the other side straight away when this page goes away (tab closed / navigated).
      if (global.addEventListener) {
        global.addEventListener('pagehide', (ev) => {
          if (!this._destroyed && !(ev && ev.persisted)) this._rawSend({ type: '__bye' });
        });
      }
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
            if (!this.isHost) {
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
      const drop = () => {
        this.peerConns.delete(conn);
        this.peerConnected = this.peerConns.size > 0;
      };
      conn.on('close', drop);
      conn.on('error', drop);
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
