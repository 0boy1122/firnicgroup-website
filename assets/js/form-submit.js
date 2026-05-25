/* ── Firnic Form Submission Helper ─────────────────────────────────────────── */
(function () {
  'use strict';

  const WA_NUMBER = '233592997811';

  const FORM_LABELS = {
    hotel:   'Hotel Booking',
    car:     'Car Rental',
    ride:    'Ride Request',
    event:   'Event Enquiry',
    massage: 'Massage Booking',
    driver:  'Driver Application',
    general: 'Enquiry'
  };

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
      border-radius:4px;animation:firnicFadeIn 0.3s ease;
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

  window.firnicSubmit = function (e, formType) {
    e.preventDefault();
    const form  = e.target;
    const btn   = form.querySelector('[type="submit"]');
    const orig  = btn ? btn.textContent : '';
    const type  = formType || form.dataset.firnicForm || 'general';
    const label = FORM_LABELS[type] || 'Enquiry';

    if (btn) { btn.disabled = true; btn.textContent = 'Opening WhatsApp…'; }

    const data = collectForm(form);
    const time = new Date().toLocaleString('en-GH', { timeZone: 'Africa/Accra' });

    const lines = Object.entries(data)
      .filter(([k]) => k !== 'agree')
      .map(([k, v]) => `• ${k.replace(/_/g, ' ')}: ${v}`)
      .join('\n');

    const msg = encodeURIComponent(
      `Hello Firnic! I'd like to submit a *${label}*.\n\n${lines}\n\n_Sent: ${time}_`
    );
    const waUrl = `https://wa.me/${WA_NUMBER}?text=${msg}`;

    /* Driver form gets a special post-submit instructions panel */
    if (type === 'driver') {
      showBanner(form, true,
        '✅ <strong>Application details sent to WhatsApp!</strong><br>' +
        'Please also send your documents (licence, registration, insurance, roadworthiness + vehicle photos) ' +
        'via WhatsApp or email:<br>' +
        `<a href="${waUrl}" style="color:#4ade80;font-weight:700" target="_blank">📱 Open WhatsApp →</a> &nbsp;|&nbsp; ` +
        `<a href="mailto:info@firnicgroup.com?subject=Driver%20Application%20Documents" style="color:#4ade80;font-weight:700">✉️ Email Documents →</a>`
      );
    } else {
      showBanner(form, true,
        '✅ <strong>Request ready!</strong> Opening WhatsApp now…<br>' +
        `<a href="${waUrl}" style="color:#4ade80" target="_blank">Click here if WhatsApp didn't open →</a>`
      );
    }

    form.reset();
    setTimeout(() => window.open(waUrl, '_blank'), 500);

    if (btn) { btn.disabled = false; btn.textContent = orig; }
  };

  /* Auto-attach to any form with data-firnic-form attribute */
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('form[data-firnic-form]').forEach(form => {
      form.addEventListener('submit', e => window.firnicSubmit(e, form.dataset.firnicForm));
    });
  });

})();
