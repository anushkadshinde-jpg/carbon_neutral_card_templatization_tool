// Dashboard shell: sidebar menus, collapse, and hash routing between the
// Templates landing page and the Playing Card tool.

const ROUTES = {
  '/': 'view-home',
  '/templates/playing-card': 'view-tool',
  '/templates/carbon-neutral-card': 'view-carbon',
};

function route() {
  const path = location.hash.replace(/^#/, '') || '/';
  const view = ROUTES[path] || ROUTES['/'];
  for (const id of Object.values(ROUTES)) document.getElementById(id).hidden = id !== view;
  document.querySelectorAll('[data-route]').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === path);
  });
  window.scrollTo(0, 0);
}

document.querySelectorAll('.nav-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const group = btn.closest('.nav-group');
    group.classList.toggle('open');
    btn.setAttribute('aria-expanded', group.classList.contains('open'));
    document.getElementById('app').classList.remove('collapsed');
  });
});

document.getElementById('collapse').addEventListener('click', () => {
  document.getElementById('app').classList.toggle('collapsed');
});

// Pages that live in the main dashboard, not in this tool.
const toast = document.getElementById('toast');
let toastTimer;
document.querySelectorAll('[data-external]').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    toast.textContent = 'This opens in the main 14 Trees dashboard.';
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 2400);
  });
});

window.addEventListener('hashchange', route);
route();
