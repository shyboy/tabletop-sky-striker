/**
 * Screen Wake Lock guard for Tabletop Sky Striker (host tablet, phone cockpit, ground crew).
 * In tabletop mode the tablet lies untouched on the desk for an 8-10 minute voyage while the
 * player steers from the phone; in gyro + blow mode the phone screen may also go untouched.
 * Requests a 'screen' wake lock opportunistically, retries on user gesture if the browser
 * requires activation, and re-acquires automatically whenever the tab returns to foreground.
 */
(function (global) {
  'use strict';

  function createWakeLockGuard(env) {
    const win = env || global;
    const doc = win && win.document;
    const nav = win && win.navigator;
    let sentinel = null;
    let pending = null;
    let disposed = false;

    function supported() {
      return Boolean(nav && nav.wakeLock && typeof nav.wakeLock.request === 'function');
    }

    function acquire() {
      if (disposed || !supported()) return Promise.resolve(false);
      if (doc && doc.hidden) return Promise.resolve(false);
      if (sentinel && !sentinel.released) return Promise.resolve(true);
      if (pending) return pending;

      pending = Promise.resolve()
        .then(() => nav.wakeLock.request('screen'))
        .then((lock) => {
          pending = null;
          if (disposed || (doc && doc.hidden)) {
            if (lock && typeof lock.release === 'function') {
              try { lock.release().catch(() => {}); } catch (_) {}
            }
            return false;
          }
          sentinel = lock;
          if (lock && typeof lock.addEventListener === 'function') {
            lock.addEventListener('release', () => {
              if (sentinel === lock) sentinel = null;
            });
          }
          return true;
        })
        .catch(() => {
          pending = null;
          return false;
        });
      return pending;
    }

    function release() {
      const cur = sentinel;
      sentinel = null;
      if (cur && !cur.released && typeof cur.release === 'function') {
        try { return cur.release().catch(() => {}); } catch (_) {}
      }
      return Promise.resolve();
    }

    function onVisibilityChange() {
      if (!doc) return;
      if (doc.hidden) {
        release();
      } else {
        acquire();
      }
    }

    function onGesture() {
      if (!sentinel || sentinel.released) acquire();
    }

    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', onVisibilityChange);
      ['pointerdown', 'touchstart', 'keydown'].forEach((evt) => {
        doc.addEventListener(evt, onGesture, { passive: true });
      });
    }
    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('pagehide', () => release());
    }

    acquire();

    return {
      acquire,
      release,
      isActive: () => Boolean(sentinel && !sentinel.released),
      dispose: () => {
        disposed = true;
        return release();
      }
    };
  }

  global.createWakeLockGuard = createWakeLockGuard;
  if (typeof document !== 'undefined') {
    global.skyWakeLock = createWakeLockGuard(global);
  }
})(typeof window !== 'undefined' ? window : globalThis);
