/* ── Firnic Form Submission Helper ─────────────────────────────────────────── */
(function () {
  'use strict';

  const API_BASE = (location.protocol === 'file:')
    ? 'http://localhost:3000'
    : '';

  /**
   * Collect all named form fields into a plain object.
   * Skips file inputs (can't serialise binary over JSON).
   */
  function collectForm(form) {
    const data = {};
    new FormData(form).forEach((val, key) => {
      if (typeof val === 'string') data[key] = val;
    });
    return data;
  }

  /**
   * Show a success or error banner inside the form's container.
   */
  function showBanner(form, ok, msg) {
    let banner = form.querySelector('.firnic-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'firnic-banner';
      banner.style.cssText = `
        margin-top:1rem;padding:1rem 1.25rem;border-radius:8px;
        font-size:0.85rem;font-weight:600;line-height:1.5;text-align:center;
        animation:firnicFadeIn 0.3s ease;
      `;
      form.appendChild(banner);
    }
    banner.style.background = ok
      ? 'rgba(34,197,94,0.12)' : 'rgba(229,57,53,0.12)';
    banner.style.border = ok
      ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(229,57,53,0.3)';
    banner.style.color = ok ? '#86efac' : '#fca5a5';
    banner.innerHTML = msg;
    banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const style = document.createElement('style');
  style.textContent = `@keyframes firnicFadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}`;
  document.head.appendChild(style);

  /**
   * Main handler — attach to any <form data-firnic-form="type">
   * type: hotel | car | ride | delivery | event | massage | contact
   */
  window.firnicSubmit = async function (e, formType) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('[type="submit"]');
    const original = btn ? btn.textContent : '';

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Sending…';
    }

    const data = collectForm(form);
    data._type = formType || form.dataset.firnicForm || 'general';

    // Add page context
    data._page = location.pathname;
    data._time = new Date().toLocaleString('en-GH', { timeZone: 'Africa/Accra' });

    try {
      const res = await fetch(API_BASE + '/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!res.ok) throw new Error('Server returned ' + res.status);
      const json = await res.json();

      if (json.ok) {
        showBanner(form, true,
          '✓ Request received! We\'ll confirm within 2 hours.<br>' +
          'For immediate help: <a href="https://wa.me/233592997811" style="color:#4ade80" target="_blank">WhatsApp us →</a>');
        form.reset();
      } else {
        throw new Error(json.error || 'Unknown error');
      }

    } catch (err) {
      // Fallback: open WhatsApp with form data pre-filled
      const summary = Object.entries(data)
        .filter(([k]) => !k.startsWith('_'))
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');

      const waText = encodeURIComponent(
        `Hello Firnic, I'd like to make an enquiry:\n\n${summary}`
      );

      showBanner(form, false,
        '⚠ Could not send automatically. ' +
        `<a href="https://wa.me/233592997811?text=${waText}" ` +
        `style="color:#fca5a5;text-decoration:underline" target="_blank">` +
        'Click here to send via WhatsApp instead →</a>');
    }

    if (btn) {
      btn.disabled = false;
      btn.textContent = original;
    }
  };

  // Auto-attach to any form with data-firnic-form attribute
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('form[data-firnic-form]').forEach(form => {
      form.addEventListener('submit', e => {
        window.firnicSubmit(e, form.dataset.firnicForm);
      });
    });
  });

})();
