// Auth gate + hash router.

const main = document.getElementById('main')
let session = null
let cleanup = null
let routeToken = 0

async function route() {
  if (!session) return
  const [, name, id] = location.hash.split('/') // "#/project/<id>"
  const page = Pages[name] && (id || !['client', 'project'].includes(name)) ? name : 'dashboard'
  const section = { client: 'clients', project: 'projects' }[page] ?? page
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === section))

  cleanup?.()
  cleanup = null
  const token = ++routeToken
  // Each route renders into a fresh element, so a slow previous page can't overwrite the new one.
  const view = document.createElement('div')
  main.replaceChildren(view)
  window.scrollTo(0, 0)
  try {
    const dispose = await Pages[page](view, id)
    if (token === routeToken) cleanup = dispose ?? null
    else dispose?.()
  } catch (err) {
    if (token === routeToken) view.innerHTML = errorBox(err)
  }
}

function showView() {
  document.getElementById('login-view').hidden = !!session
  document.getElementById('app-view').hidden = !session
  if (session) {
    document.getElementById('user-email').textContent = session.user.email
    route()
  } else {
    cleanup?.()
    cleanup = null
    main.replaceChildren()
  }
}

db.auth.onAuthStateChange((_event, s) => {
  const changed = !!s !== !!session
  session = s
  // Defer: Supabase calls made directly inside this callback can deadlock.
  if (changed || _event === 'INITIAL_SESSION') setTimeout(showView, 0)
})

window.addEventListener('hashchange', route)

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.target
  const errEl = document.getElementById('login-error')
  const button = form.querySelector('button')
  errEl.hidden = true
  button.disabled = true
  const { error } = await db.auth.signInWithPassword({ email: form.email.value, password: form.password.value })
  button.disabled = false
  if (error) {
    errEl.textContent = error.message === 'Invalid login credentials' ? 'מייל או סיסמה שגויים' : error.message
    errEl.hidden = false
  }
})

document.getElementById('logout').addEventListener('click', () => db.auth.signOut())
