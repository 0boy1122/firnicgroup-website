/* ── Firnic Form Submission Helper ─────────────────────────────────────────── */
(function () {
  'use strict';

  const API_BASE = '';

  function collectForm(form) {
    const data = {};
    new FormData(form).forEach((val, key) => {
      if (typeof val === 'string' && val.trim()) data[key] = val.trim();
    });
    return data;
  }

  function showBanner(form, ok, html) {
    let banner = form.querySelector('.firnic-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'firnic-banner';
      form.appendChild(banner);
    }
    banner.style.cssText = `
      margin-top:1.25rem;padding:1rem 1.25rem;
      font-size:0.85rem;font-weight:500;line-height:1.6;text-align:center;
      animation:firnicFadeIn 0.3s ease;
      background:${ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'};
      border:1px solid ${ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'};
      color:${ok ? '#86efac' : '#fca5a5'};
    `;
    banner.innerHTML = html;
    banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const style = document.createElement('style');
  style.textContent = `@keyframes firnicFadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}`;
  document.head.appendChild(style);

  window.firnicSubmit = async function (e, formType) {
    e.preventDefault();
    const form  = e.target;
    const btn   = form.querySelector('[type="submit"]');
    const orig  = btn ? btn.textContent : '';
    const type  = formType || form.dataset.firnicForm || 'general';

    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    const data   = collectForm(form);
    data._type   = type;
    data._page   = location.pathname;
    data._time   = new Date().toLocaleString('en-GH', { timeZone: 'Africa/Accra' });

    try {
      const res = await fetch(API_BASE + '/api/submit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data)
      });

      if (!res.ok) throw new Error('Server returned ' + res.status);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Unknown error');

      showBanner(form, true,
        '✅ <strong>Request received!</strong> We\'ll confirm within 2 hours.<br>' +
        'For immediate assistance call us at <strong>+233 592 997 811</strong>.'
      );

      form.reset();

    } catch (err) {
      showBanner(form, false,
        '⚠ Could not reach the server. Please try again or call us at <strong>+233 592 997 811</strong>.'
      );
    }

    if (btn) { btn.disabled = false; btn.textContent = orig; }
  };

  /* Auto-attach to any form with data-firnic-form attribute */
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('form[data-firnic-form]').forEach(form => {
      form.addEventListener('submit', e => window.firnicSubmit(e, form.dataset.firnicForm));
    });
  });

})();
