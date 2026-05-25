/* ── Firnic Form Submission Helper ─────────────────────────────────────────── */
(function () {
  'use strict';

  const WA_NUMBER = '233592997811';

  /* Render serves both frontend and API — always same-origin */
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

      /* ── Driver form: extra step for document uploads ── */
      if (type === 'driver') {
        const waLines = Object.entries(data)
          .filter(([k]) => !k.startsWith('_') && k !== 'agree')
          .map(([k, v]) => `• ${k}: ${v}`).join('\n');
        const waUrl = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('Hello Firnic! Here are my driver documents:\n\n' + waLines)}`;

        showBanner(form, true,
          '✅ <strong>Application received!</strong><br>' +
          'Please send your documents (licence, registration, insurance, roadworthiness certificate + vehicle photos) via:<br><br>' +
          `<a href="${waUrl}" style="color:#4ade80;font-weight:700" target="_blank">📱 Send via WhatsApp →</a>` +
          `&nbsp;&nbsp;|&nbsp;&nbsp;` +
          `<a href="mailto:info@firnicgroup.com?subject=Driver%20Application%20Documents%20-%20${encodeURIComponent((data.firstName||'') + ' ' + (data.lastName||''))}" style="color:#4ade80;font-weight:700">✉️ Send via Email →</a>`
        );
      } else {
        showBanner(form, true,
          '✅ <strong>Request received!</strong> We\'ll confirm within 2 hours.<br>' +
          'Need immediate help? <a href="https://wa.me/' + WA_NUMBER + '" style="color:#4ade80" target="_blank">WhatsApp us →</a>'
        );
      }

      form.reset();

    } catch (err) {
      /* Fallback: build WhatsApp message from form data */
      const lines = Object.entries(data)
        .filter(([k]) => !k.startsWith('_') && k !== 'agree')
        .map(([k, v]) => `• ${k}: ${v}`).join('\n');
      const waText = encodeURIComponent(`Hello Firnic, I'd like to make an enquiry:\n\n${lines}`);
      const waUrl  = `https://wa.me/${WA_NUMBER}?text=${waText}`;

      showBanner(form, false,
        '⚠ Could not reach the server. ' +
        `<a href="${waUrl}" style="color:#fca5a5;text-decoration:underline" target="_blank">Send via WhatsApp instead →</a>`
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
