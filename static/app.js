// ─── API Helper ────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  return res;
}

async function apiJson(path, opts = {}) {
  const res = await api(path, opts);
  if (!res) return null;
  return res.json();
}

// ─── Toast ─────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

// ─── Alpine Global Store ───────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.store('auth', {
    user: null,
    loading: true,

    async init() {
      try {
        const data = await apiJson('/api/me');
        if (data?.user) {
          this.user = data.user;
        }
      } catch { /* not logged in */ }
      this.loading = false;
    },

    get loggedIn() { return !!this.user; },

    async logout() {
      await api('/api/auth/logout', { method: 'POST' });
      this.user = null;
      window.location.href = '/';
    },
  });
});

// ─── Formatters ────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateShort(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// ─── Nav Injection ─────────────────────────────────────────────────
const NAV_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36z"/></svg>`;

function injectNav() {
  const nav = document.getElementById('main-nav');
  if (!nav) return;
  nav.innerHTML = `
    <a href="/" class="nav-brand">${NAV_SVG} Wandr</a>
    <div class="nav-links" x-data>
      <template x-if="$store.auth.loggedIn">
        <div style="display:flex;align-items:center;gap:var(--space-2)">
          <a href="/my-trips" class="nav-link">My Trips</a>
          <a href="/plan" class="nav-link">Plan a Trip</a>
          <img :src="$store.auth.user?.picture || ''" class="nav-avatar"
               @click="$store.auth.logout()" :title="'Sign out (' + ($store.auth.user?.name || '') + ')'"
               onerror="this.style.display='none'">
        </div>
      </template>
      <template x-if="!$store.auth.loggedIn && !$store.auth.loading">
        <a href="/api/auth/google" class="btn btn-primary btn-sm">Sign in</a>
      </template>
    </div>`;
}

document.addEventListener('DOMContentLoaded', injectNav);
