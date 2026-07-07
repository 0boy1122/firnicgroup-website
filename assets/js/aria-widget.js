/* ── Aria AI Widget ── Firnic Group ────────────────────────────────────────── */
(function () {
  'use strict';

  // Detect API base: if served via local server use relative, else localhost
  const API_BASE = (location.protocol === 'file:')
    ? 'http://localhost:3000'
    : '';

  const QUICK_REPLIES = [
    'Room rates?',
    'Book a massage',
    'Car hire prices',
    'Plan an event',
    'Contact details',
  ];

  let messages = []; // conversation history sent to API
  let isOpen = false;
  let hasShownNudge = false;

  // ── Build DOM ──────────────────────────────────────────────────────────────
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  // Resolve path relative to this script's location
  const scriptSrc = document.currentScript?.src || '';
  const base = scriptSrc.replace(/\/assets\/js\/aria-widget\.js.*$/, '');
  css.href = (base || '') + '/assets/css/aria-widget.css';
  document.head.appendChild(css);

  const html = `
  <div id="aria-bubble">
    <div id="aria-nudge">Hi! I'm Aria — how can I help? ✨</div>
    <button id="aria-btn" aria-label="Chat with Aria">
      <div id="aria-dot"></div>
      <svg class="icon-chat" width="24" height="24" fill="none" stroke="#0e0e0e" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <svg class="icon-close" width="22" height="22" fill="none" stroke="#0e0e0e" stroke-width="2.5" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </div>

  <div id="aria-panel" role="dialog" aria-label="Chat with Aria">
    <div id="aria-header">
      <div class="aria-avatar">✦</div>
      <div class="aria-info">
        <strong>Aria</strong>
        <span>Firnic Concierge · AI assistant</span>
      </div>
      <div class="aria-online" title="Online"></div>
    </div>
    <div id="aria-messages"></div>
    <div id="aria-quick"></div>
    <div id="aria-input-row">
      <textarea id="aria-input" rows="1" placeholder="Ask about rooms, cars, massage…" maxlength="600"></textarea>
      <button id="aria-send" aria-label="Send">
        <svg width="16" height="16" fill="none" stroke="#0e0e0e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>
    <div id="aria-footer">Powered by <a href="#" tabindex="-1">Firnic AI</a></div>
  </div>`;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);

  const bubble   = document.getElementById('aria-bubble');
  const panel    = document.getElementById('aria-panel');
  const btn      = document.getElementById('aria-btn');
  const nudge    = document.getElementById('aria-nudge');
  const dot      = document.getElementById('aria-dot');
  const msgBox   = document.getElementById('aria-messages');
  const quickBox = document.getElementById('aria-quick');
  const input    = document.getElementById('aria-input');
  const sendBtn  = document.getElementById('aria-send');

  // ── Quick replies ──────────────────────────────────────────────────────────
  function renderQuickReplies(show) {
    quickBox.innerHTML = '';
    if (!show) return;
    QUICK_REPLIES.forEach(label => {
      const b = document.createElement('button');
      b.className = 'aria-quick-btn';
      b.textContent = label;
      b.onclick = () => sendMessage(label);
      quickBox.appendChild(b);
    });
  }

  // ── Add message bubble ─────────────────────────────────────────────────────
  function addMsg(text, role, isError) {
    const div = document.createElement('div');
    div.className = 'aria-msg ' + (isError ? 'error' : role);
    // Convert **bold** and newlines
    div.innerHTML = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
    msgBox.appendChild(div);
    msgBox.scrollTop = msgBox.scrollHeight;
    return div;
  }

  // ── Typing indicator ───────────────────────────────────────────────────────
  function showTyping() {
    const t = document.createElement('div');
    t.className = 'aria-typing';
    t.id = 'aria-typing';
    t.innerHTML = '<span></span><span></span><span></span>';
    msgBox.appendChild(t);
    msgBox.scrollTop = msgBox.scrollHeight;
  }
  function hideTyping() {
    const t = document.getElementById('aria-typing');
    if (t) t.remove();
  }

  // ── Send message ───────────────────────────────────────────────────────────
  async function sendMessage(text) {
    text = (text || input.value).trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';
    sendBtn.disabled = true;
    renderQuickReplies(false);

    addMsg(text, 'user');
    messages.push({ role: 'user', content: text });

    showTyping();

    try {
      const res = await fetch(API_BASE + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages })
      });

      hideTyping();

      if (res.status === 503) {
        // AI not configured — give useful contact info without showing an error
        const fallback = 'I\'m not available right now, but our team is! Reach us directly:\n\n📞 **+233 592 997 811**\n✉️ info@firnicgroup.com';
        addMsg(fallback, 'bot');
        messages.push({ role: 'assistant', content: fallback });
        sendBtn.disabled = false;
        input.focus();
        return;
      }

      if (!res.ok) throw new Error('Server error ' + res.status);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      messages.push({ role: 'assistant', content: data.reply });
      addMsg(data.reply, 'bot');

    } catch (e) {
      hideTyping();
      const errMsg = 'Sorry, something went wrong. Please contact us directly:\n\n📞 **+233 592 997 811**\n✉️ info@firnicgroup.com';
      addMsg(errMsg, 'bot', false);
      messages.push({ role: 'assistant', content: errMsg });
    }

    sendBtn.disabled = false;
    input.focus();
  }

  // ── Toggle panel ───────────────────────────────────────────────────────────
  function toggle() {
    isOpen = !isOpen;
    bubble.classList.toggle('open', isOpen);
    panel.classList.toggle('open', isOpen);
    nudge.classList.remove('show');
    dot.classList.remove('show');

    if (isOpen) {
      input.focus();
      if (msgBox.children.length === 0) {
        // Welcome message
        setTimeout(() => {
          addMsg('Hello! I\'m **Aria**, your Firnic concierge. I can help with hotel bookings, car hire, massage appointments, event planning, and more. How can I assist you today?', 'bot');
          renderQuickReplies(true);
        }, 300);
      }
    }
  }

  btn.addEventListener('click', toggle);

  // Close on outside click
  document.addEventListener('click', e => {
    if (isOpen && !panel.contains(e.target) && !btn.contains(e.target)) toggle();
  });

  // Send on Enter (Shift+Enter = newline)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  sendBtn.addEventListener('click', () => sendMessage());

  // Auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 90) + 'px';
  });

  // ── Nudge after 6 seconds ──────────────────────────────────────────────────
  setTimeout(() => {
    if (!isOpen && !hasShownNudge) {
      hasShownNudge = true;
      nudge.classList.add('show');
      dot.classList.add('show');
      setTimeout(() => nudge.classList.remove('show'), 5000);
    }
  }, 6000);

})();
