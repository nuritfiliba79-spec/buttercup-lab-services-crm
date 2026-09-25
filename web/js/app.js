// Auth (login + two-step sign-up), role handling and hash router.

const main = document.getElementById('main')
let session = null
let cleanup = null
let routeToken = 0

// ---------- Router ----------

async function route() {
  if (!session || !Profile) return
  let [, name, id] = location.hash.split('/') // "#/project/<id>"
  if (name === 'company') [name, id] = ['client', Profile.client_id]
  if (!isStaff() && ['clients', 'labs'].includes(name)) name = 'dashboard'

  const page = Pages[name] && (id || !['client', 'project'].includes(name)) ? name : 'dashboard'
  const section = { client: isStaff() ? 'clients' : 'company', project: 'projects' }[page] ?? page
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

// ---------- Session / role ----------

const loginView = document.getElementById('login-view')
const appView = document.getElementById('app-view')
const loginCard = loginView.querySelector('.login-card')

async function showView() {
  Profile = null
  applyRoleClasses()
  cleanup?.()
  cleanup = null
  main.replaceChildren()

  if (!session) {
    loginCard.classList.remove('forced')
    loginView.hidden = false
    appView.hidden = true
    if (!document.querySelector('[data-panel="login"]:not([hidden]), [data-panel^="signup"]:not([hidden])')) showPanel('login')
    return
  }

  const { data, error } = await db.from('profiles')
    .select('role, client_id, lab_id, must_change_password').eq('id', session.user.id).maybeSingle()
  // No profile row means the account isn't set up; treat it as a customer with no data.
  Profile = data ?? { role: 'client', client_id: null }
  if (error) toast(errorMessage(error))

  // Logged in with an initial password: block the app until a personal password is set.
  if (Profile.must_change_password) {
    loginCard.classList.add('forced')
    loginView.hidden = false
    appView.hidden = true
    changeForm.email.value = session.user.email
    changeForm.password.value = ''
    changeForm.confirm.value = ''
    showPanel('change-password')
    return
  }

  loginCard.classList.remove('forced')
  loginView.hidden = true
  appView.hidden = false
  applyRoleClasses()
  document.getElementById('user-email').textContent = session.user.email
  document.getElementById('user-role').textContent = ROLE_LABELS[Profile.role] ?? Profile.role
  route()
}

db.auth.onAuthStateChange((event, s) => {
  const changed = !!s !== !!session
  session = s
  // Defer: Supabase calls made directly inside this callback can deadlock.
  if (changed || event === 'INITIAL_SESSION') setTimeout(showView, 0)
})

window.addEventListener('hashchange', route)
document.getElementById('logout').addEventListener('click', () => db.auth.signOut())

// ---------- Login / sign-up screens ----------

const panels = document.querySelectorAll('[data-panel]')

function showPanel(name) {
  panels.forEach((p) => {
    p.hidden = p.dataset.panel !== name
    p.querySelectorAll('.error').forEach((e) => (e.hidden = true))
  })
  const tab = name.startsWith('signup') ? 'signup' : 'login'
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tab)
    t.setAttribute('aria-selected', t.dataset.tab === tab)
  })
  document.querySelector(`[data-panel="${name}"] input:not([readonly])`)?.focus()
}

document.getElementById('login-view').addEventListener('click', (e) => {
  const target = e.target.closest('[data-tab]')
  if (target) showPanel(target.dataset.tab)
})

function showError(form, message) {
  const el = form.querySelector('.error')
  el.textContent = message
  el.hidden = false
}

// Runs native constraint validation and reports the first problem in Hebrew.
function validate(form) {
  for (const input of form.querySelectorAll('input')) {
    if (input.checkValidity()) continue
    const label = input.closest('label')?.firstChild.textContent.replace('*', '').trim()
    const v = input.validity
    input.focus()
    if (v.valueMissing) return `יש למלא את השדה "${label}"`
    if (v.typeMismatch && input.type === 'email') return 'כתובת המייל אינה תקינה'
    if (v.patternMismatch) return input.title || `הערך בשדה "${label}" אינו תקין`
    if (v.tooShort) return `"${label}" צריך להכיל לפחות ${input.minLength} תווים`
    return `הערך בשדה "${label}" אינו תקין`
  }
  return null
}

async function withBusy(form, fn) {
  const buttons = form.querySelectorAll('button')
  buttons.forEach((b) => (b.disabled = true))
  try {
    await fn()
  } finally {
    buttons.forEach((b) => (b.disabled = false))
  }
}

const AUTH_ERRORS = {
  'Invalid login credentials': 'מייל או סיסמה שגויים',
  'Email not confirmed': 'המייל עדיין לא אומת. בדקו את תיבת הדואר.',
  'User already registered': 'כתובת המייל כבר רשומה במערכת. אפשר להיכנס עם הסיסמה.',
}
const authMessage = (error) => AUTH_ERRORS[error.message] ?? error.message

// Login
const loginForm = document.getElementById('login-form')
loginForm.addEventListener('submit', (e) => {
  e.preventDefault()
  const problem = validate(loginForm)
  if (problem) return showError(loginForm, problem)
  withBusy(loginForm, async () => {
    const { error } = await db.auth.signInWithPassword({
      email: loginForm.email.value.trim(),
      password: loginForm.password.value,
    })
    if (error) showError(loginForm, authMessage(error))
  })
})

// Sign-up step 1: company details
const detailsForm = document.getElementById('signup-details')
const passwordForm = document.getElementById('signup-password')
let signupDetails = null

detailsForm.addEventListener('submit', (e) => {
  e.preventDefault()
  for (const input of detailsForm.querySelectorAll('input')) input.value = input.value.trim()
  const problem = validate(detailsForm)
  if (problem) return showError(detailsForm, problem)
  signupDetails = Object.fromEntries(new FormData(detailsForm))
  passwordForm.email.value = signupDetails.email
  passwordForm.password.value = ''
  passwordForm.confirm.value = ''
  showPanel('signup-password')
})

document.getElementById('signup-back').addEventListener('click', () => showPanel('signup'))

// Shared rules for a new password; returns an error message or null.
function passwordProblem(form) {
  const problem = validate(form)
  if (problem) return problem
  const password = form.password.value
  if (password.length < 8) return 'הסיסמה צריכה להכיל לפחות 8 תווים'
  if (!/[a-zA-Z֐-׿]/.test(password) || !/\d/.test(password)) {
    return 'הסיסמה צריכה לכלול לפחות אות אחת ומספר אחד'
  }
  if (password !== form.confirm.value) return 'הסיסמאות אינן תואמות'
  return null
}

// Sign-up step 2: create a password for the email from step 1
passwordForm.addEventListener('submit', (e) => {
  e.preventDefault()
  const problem = passwordProblem(passwordForm)
  if (problem) return showError(passwordForm, problem)
  const password = passwordForm.password.value

  const { email, company_name, contact_person, phone } = signupDetails
  withBusy(passwordForm, async () => {
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: {
        data: { company_name, contact_person, phone }, // read by the handle_new_user() DB trigger
        emailRedirectTo: location.origin + location.pathname,
      },
    })
    if (error) return showError(passwordForm, authMessage(error))
    // With email confirmation off Supabase returns a session right away and we're logged in.
    // Supabase returns a user with no identities when the email already exists.
    if (!data.session && data.user?.identities?.length === 0) {
      return showError(passwordForm, AUTH_ERRORS['User already registered'])
    }
    detailsForm.reset()
    signupDetails = null
    if (!data.session) showPanel('signup-done')
  })
})

// First login with an initial password: replace it with a personal one
const changeForm = document.getElementById('change-password')

changeForm.addEventListener('submit', (e) => {
  e.preventDefault()
  const problem = passwordProblem(changeForm)
  if (problem) return showError(changeForm, problem)
  withBusy(changeForm, async () => {
    const { error } = await db.auth.updateUser({ password: changeForm.password.value })
    if (error) {
      const sameAsOld = error.code === 'same_password' || /different from the old/i.test(error.message)
      return showError(changeForm, sameAsOld ? 'הסיסמה החדשה חייבת להיות שונה מהסיסמה הראשונית' : authMessage(error))
    }
    const { error: rpcError } = await db.rpc('password_changed')
    if (rpcError) return showError(changeForm, errorMessage(rpcError))
    toast('הסיסמה עודכנה')
    showView()
  })
})

document.getElementById('change-password-cancel').addEventListener('click', () => db.auth.signOut())
