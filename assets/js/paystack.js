/* ── Firnic Paystack Integration ─────────────────────────────────────────── */
(function () {
  'use strict';
  const KEY = 'pk_live_77969f5a8fcd5561bcb51966234e0a90a26cb922';

  function loadSDK(cb) {
    if (window.PaystackPop) { cb(); return; }
    const s = document.createElement('script');
    s.src = 'https://js.paystack.co/v1/inline.js';
    s.onload = cb;
    s.onerror = function () {
      alert('Could not load payment module. Check your connection and try again.');
    };
    document.head.appendChild(s);
  }

  /* opts: { email, amount (GHS), name, meta, onSuccess(ref), onClose() } */
  window.firnicPay = function (opts) {
    loadSDK(function () {
      const ref = 'FRN-' + Date.now().toString(36).toUpperCase() + '-' +
                  Math.random().toString(36).substr(2, 4).toUpperCase();
      PaystackPop.setup({
        key:      KEY,
        email:    opts.email || 'guest@firnicgroup.com',
        amount:   Math.round((opts.amount || 0) * 100),
        currency: 'GHS',
        ref:      ref,
        label:    opts.name  || 'Customer',
        metadata: opts.meta  || {},
        callback: function (r) { opts.onSuccess(r.reference); },
        onClose:  function ()  { if (opts.onClose) opts.onClose(); }
      }).openIframe();
    });
  };
})();
