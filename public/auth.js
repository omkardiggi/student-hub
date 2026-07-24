// auth.js — login / signup
const $ = (id) => document.getElementById(id);
let mode = 'login';

function setMode(m) {
  mode = m;
  const signup = m === 'signup';
  $('tabLogin').classList.toggle('active', !signup);
  $('tabSignup').classList.toggle('active', signup);
  $('nameField').style.display = signup ? '' : 'none';
  $('authTitle').textContent = signup ? 'Create your account' : 'Welcome back';
  $('authSub').textContent = signup ? 'Start turning doubts into lessons.' : 'Pick up where you left off.';
  $('authBtn').textContent = signup ? 'Create account →' : 'Log in →';
  $('password').autocomplete = signup ? 'new-password' : 'current-password';
  $('authError').textContent = '';
}
$('tabLogin').onclick = () => setMode('login');
$('tabSignup').onclick = () => setMode('signup');

async function submit() {
  const body = { name: $('name').value, email: $('email').value, password: $('password').value };
  $('authBtn').disabled = true;
  $('authError').textContent = '';
  try {
    const res = await fetch(mode === 'signup' ? '/api/register' : '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || (res.status === 500 ? 'Server error — please try again.' : 'Could not sign in.'));
    location.href = '/app.html';
  } catch (e) {
    $('authError').textContent = e.message;
    $('authBtn').disabled = false;
  }
}
$('authBtn').onclick = submit;
$('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

// already logged in? skip
fetch('/api/me').then(r => r.json()).then(d => { if (d.user) location.href = '/app.html'; });
