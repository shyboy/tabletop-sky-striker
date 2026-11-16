/**
 * No-zoom guard for phone / tablet pages.
 * Rapid taps on the cockpit (gust, roll, cheer…) must never be read by the browser as
 * "double-tap to zoom" or a pinch, which would throw the whole layout off-screen mid-flight.
 * CSS `touch-action: manipulation` covers modern browsers; this script covers iOS Safari / WeChat
 * WebViews, which ignore `user-scalable=no`.
 */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  const opts = { passive: false };
  const isEditable = (el) => Boolean(el && el.closest && el.closest('input, textarea, select, [contenteditable="true"]'));
  const isInteractive = (el) => Boolean(el && el.closest && el.closest('button, a, label, summary, select, input, textarea, [role="button"], [role="tab"], canvas'));

  // iOS pinch gestures
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
    document.addEventListener(type, (ev) => ev.preventDefault(), opts);
  });

  // Two-finger pinch on browsers that expose it through touchmove
  document.addEventListener('touchmove', (ev) => {
    if (ev.touches && ev.touches.length > 1 && !isEditable(ev.target)) ev.preventDefault();
  }, opts);

  // Double-tap on plain (non-button) areas: swallow the second tap so it cannot zoom.
  // Buttons are left alone so fast repeated presses keep working (CSS already blocks their zoom).
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (ev) => {
    const now = ev.timeStamp || Date.now();
    if (now - lastTouchEnd < 350 && !isInteractive(ev.target)) ev.preventDefault();
    lastTouchEnd = now;
  }, opts);

  document.addEventListener('dblclick', (ev) => {
    if (!isEditable(ev.target)) ev.preventDefault();
  }, opts);
})();
