// Admin panel: admin-only login, system dashboard, user & role management, data management.

const main = document.getElementById('main')
const loginView = document.getElementById('login-view')
const appView = document.getElementById('app-view')
const loginForm = document.getElementById('login-form')
let session = null
let cleanup = null
let routeToken = 0

// ---------- Helpers ----------

// Calls the admin-users Edge Function (service-role actions, admin-checked server side).
async function adminCall(body) {
  const { data, error } = await db.functions.invoke('admin-users', { body })
  if (error) {
    let message = error.message
    try { message = (await error.context.json()).error ?? message } catch {}
    throw new Error(message)
  }
  return data
}

// Horizontal bar list. items: [{ label, value, sub?, tip? }]
function bars(items, note) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return `<ul class="bars">${items.map((i) => `
    <li data-tip="${esc(i.tip ?? `${i.label}: ${i.value}`)}">
      <span class="bar-label">${esc(i.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(i.value / max) * 100}%"></span></span>
      <span class="bar-value">${i.value}${i.sub ? ` <span class="bar-sub">${esc(i.sub)}</span>` : ''}</span>
    </li>`).join('')}</ul>${note ? `<p class="chart-note">${esc(note)}</p>` : ''}`
}

// One floating tooltip for every [data-tip] element.
const tip = document.createElement('div')
tip.className = 'tip'
tip.hidden = true
document.body.append(tip)
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]')
  tip.hidden = !el
  if (el) tip.textContent = el.dataset.tip
})
document.addEventListener('mousemove', (e) => {
  if (tip.hidden) return
  tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8)}px`
  tip.style.top = `${e.clientY + 16}px`
})

function passwordModal(title, email, password) {
  const root = openModal({
    title,
    body: `
      <p>הסיסמה הראשונית של <b dir="ltr">${esc(email)}</b>:</p>
      <div class="password-box"><code>${esc(password)}</code>
        <button type="button" class="btn ghost small" data-copy>העתקה</button></div>
      <p class="hint">הסיסמה מוצגת פעם אחת בלבד. בכניסה הראשונה המשתמש יתבקש לבחור סיסמה אישית חדשה.</p>`,
    submitLabel: 'סגירה',
    onSubmit: () => {},
  })
  root.querySelector('[data-copy]').onclick = async (e) => {
    await navigator.clipboard.writeText(password)
    e.target.textContent = 'הועתק ✓'
  }
}

// ---------- Overview (admin dashboard) ----------

Pages.overview = async (el) => {
  el.innerHTML = `
    <div class="page-head">
      <div><h1>לוח בקרה · מנהל מערכת</h1><p class="subtitle">תמונת מצב של כל המערכת: משתמשים, לקוחות, בדיקות ודוחות</p></div>
      <span class="live" id="live">מתחבר…</span>
    </div>
    <div id="body"><p class="muted">טוען…</p></div>`
  const body = el.querySelector('#body')

  async function load() {
    const [{ users }, clients, projects, tests, reports, labs] = await Promise.all([
      adminCall({ action: 'list' }),
      db.from('clients').select('id').then(check),
      db.from('projects').select('id').then(check),
      db.from('tests').select('status, lab_id, due_date').then(check),
      db.from('reports').select('all_tests_done').then(check),
      db.from('labs').select('id, name').order('name').then(check),
    ])

    const open = tests.filter((t) => ['pending', 'in_progress'].includes(t.status))
    const overdue = open.filter(isOverdue).length
    const ready = reports.filter((r) => r.all_tests_done).length
    const pendingPw = users.filter((u) => u.must_change_password).length

    const byStatus = Object.entries(TEST_STATUS).map(([k, label]) => ({
      label, value: tests.filter((t) => t.status === k).length,
    }))
    const byLab = labs.map((l) => {
      const labOpen = open.filter((t) => t.lab_id === l.id)
      const late = labOpen.filter(isOverdue).length
      return { label: l.name, value: labOpen.length, sub: late ? `(${late} באיחור)` : '',
        tip: `${l.name}: ${labOpen.length} בדיקות פתוחות${late ? `, ${late} באיחור` : ''}` }
    }).sort((a, b) => b.value - a.value)
    const byRole = Object.entries(ROLE_LABELS).map(([k, label]) => ({
      label, value: users.filter((u) => u.role === k).length,
    }))
    const recent = [...users].filter((u) => u.last_sign_in_at)
      .sort((a, b) => b.last_sign_in_at.localeCompare(a.last_sign_in_at)).slice(0, 6)

    const stats = [
      ['משתמשים', users.length, pendingPw ? `${pendingPw} ממתינים להחלפת סיסמה` : 'כולם החליפו סיסמה', ''],
      ['לקוחות', clients.length, `${projects.length} פרויקטים`, ''],
      ['בדיקות פתוחות', open.length, overdue ? `${overdue} באיחור` : 'אין איחורים', overdue ? 'warn' : ''],
      ['דוחות מוכנים', ready, `${reports.length ? Math.round((ready / reports.length) * 100) : 0}% מההזמנות`, 'ok'],
    ]

    body.innerHTML = `
      <div class="stats">${stats.map(([label, value, sub, tone]) => `
        <div class="stat ${tone}"><div class="stat-value">${value}</div>
          <div class="stat-label">${label}</div><div class="stat-sub">${esc(sub)}</div></div>`).join('')}</div>

      <div class="grid-2">
        <section class="card"><div class="section-head"><h2>בדיקות לפי סטטוס</h2></div>${bars(byStatus, `סה"כ ${tests.length} בדיקות`)}</section>
        <section class="card"><div class="section-head"><h2>עומס פתוח לפי מעבדה</h2></div>${bars(byLab, 'בדיקות ממתינות ובביצוע')}</section>
      </div>
      <div class="grid-2">
        <section class="card"><div class="section-head"><h2>משתמשים לפי תפקיד</h2>
          <a href="#/users" class="btn link">לניהול משתמשים ←</a></div>${bars(byRole)}</section>
        <section class="card"><div class="section-head"><h2>כניסות אחרונות</h2></div>
          ${recent.length ? `<div class="table-wrap"><table>
            <thead><tr><th>משתמש</th><th>תפקיד</th><th>כניסה אחרונה</th></tr></thead>
            <tbody>${recent.map((u) => `<tr>
              <td>${val(u.full_name)}<div class="muted ltr">${esc(u.email)}</div></td>
              <td>${badge(u.role, ROLE_LABELS)}</td>
              <td class="nowrap">${new Date(u.last_sign_in_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</td>
            </tr>`).join('')}</tbody></table></div>` : '<p class="empty">אין כניסות עדיין</p>'}
        </section>
      </div>`
  }

  await load()
  return watchTables('admin-overview', ['tests', 'reports', 'clients', 'projects'], () => load().catch((e) => toast(errorMessage(e))),
    (on) => {
      const live = el.querySelector('#live')
      live.classList.toggle('on', on)
      live.textContent = on ? 'מתעדכן בזמן אמת' : 'מתחבר…'
    })
}

// ---------- Users & roles ----------

Pages.users = async (el) => {
  el.innerHTML = `
    <div class="page-head">
      <div><h1>משתמשים והרשאות</h1><p class="subtitle">יצירת משתמשים עם סיסמה ראשונית, שינוי תפקידים ואיפוס סיסמאות</p></div>
      <button class="btn primary" data-action="new">+ משתמש חדש</button>
    </div>
    <section class="card">
      <div class="toolbar">
        <input type="search" id="q" placeholder="חיפוש לפי שם או מייל…" aria-label="חיפוש">
        <select id="role" aria-label="סינון לפי תפקיד">${options(Object.entries(ROLE_LABELS), '', 'כל התפקידים')}</select>
      </div>
      <div id="list"><p class="muted">טוען…</p></div>
    </section>
    <section class="card">
      <h2>מה כל תפקיד יכול לעשות</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>תפקיד</th><th>צפייה</th><th>עריכה</th><th>מחיקה</th></tr></thead>
        <tbody>
          <tr><td>${badge('admin', ROLE_LABELS)}</td><td>הכל</td><td>הכל, כולל משתמשים והרשאות</td><td>כן</td></tr>
          <tr><td>${badge('lab_manager', ROLE_LABELS)}</td><td>הכל</td><td>לקוחות, פרויקטים, הזמנות, בדיקות, מעבדות, קבצים</td><td>לא</td></tr>
          <tr><td>${badge('technician', ROLE_LABELS)}</td><td>הזמנות שיש בהן בדיקות של המעבדה שלו</td><td>סטטוס, מבצע ותוצאה של בדיקות המעבדה שלו; הערות לדוח; העלאת קבצים</td><td>לא</td></tr>
          <tr><td>${badge('client', ROLE_LABELS)}</td><td>רק הפרויקטים של החברה שלו</td><td>—</td><td>לא</td></tr>
        </tbody></table></div>
    </section>`
  const list = el.querySelector('#list')
  const q = el.querySelector('#q')
  const roleSel = el.querySelector('#role')
  let users = []
  let labs = []
  let clients = []

  async function load() {
    ;[{ users }, labs, clients] = await Promise.all([
      adminCall({ action: 'list' }),
      db.from('labs').select('id, name').order('name').then(check),
      db.from('clients').select('id, name').order('name').then(check),
    ])
    users.sort((a, b) => (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email, 'he'))
    render()
  }

  function render() {
    const term = q.value.trim().toLowerCase()
    const shown = users.filter((u) => (!roleSel.value || u.role === roleSel.value) &&
      (!term || [u.email, u.full_name].some((v) => v?.toLowerCase().includes(term))))
    list.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>משתמש</th><th>תפקיד</th><th>שיוך</th><th>סיסמה</th><th>כניסה אחרונה</th><th></th></tr></thead>
      <tbody>${shown.map((u) => {
        const self = u.id === session.user.id
        return `<tr>
          <td><b>${val(u.full_name)}</b>${self ? ' <span class="muted">(את/ה)</span>' : ''}<div class="muted ltr">${esc(u.email)}</div></td>
          <td>${badge(u.role ?? 'client', ROLE_LABELS)}</td>
          <td>${val(u.lab?.name ?? u.client?.name)}</td>
          <td>${u.must_change_password ? '<span class="badge badge-pending">ממתין להחלפה</span>' : '<span class="muted">אישית</span>'}</td>
          <td class="nowrap muted">${u.last_sign_in_at ? fmtDate(u.last_sign_in_at) : 'טרם נכנס'}</td>
          <td class="nowrap">
            <button class="btn link" data-action="edit" data-id="${u.id}">עריכה</button>
            <button class="btn link" data-action="reset" data-id="${u.id}">איפוס סיסמה</button>
            ${self ? '' : `<button class="btn link" data-action="delete" data-id="${u.id}">מחיקה</button>`}
          </td>
        </tr>`
      }).join('') || '<tr><td colspan="6" class="empty">לא נמצאו משתמשים</td></tr>'}</tbody></table></div>`
  }

  function userModal(user) {
    const self = user?.id === session.user.id
    const root = openModal({
      title: user ? `עריכת משתמש · ${user.email}` : 'משתמש חדש',
      body: `
        ${user ? '' : '<label>מייל *<input name="email" type="email" dir="ltr" required></label>'}
        <label>שם מלא<input name="full_name" value="${esc(user?.full_name)}"></label>
        <label>תפקיד *<select name="role" required ${self ? 'disabled' : ''}>
          ${options(Object.entries(ROLE_LABELS), user?.role ?? 'lab_manager')}</select></label>
        <label data-for="technician">מעבדה *<select name="lab_id">
          ${options(labs.map((l) => [l.id, l.name]), user?.lab_id ?? '', 'בחרו מעבדה…')}</select></label>
        <label data-for="client">חברה (לקוח) *<select name="client_id">
          ${options(clients.map((c) => [c.id, c.name]), user?.client_id ?? '', 'בחרו חברה…')}</select></label>
        ${user ? '' : '<p class="hint">תיווצר סיסמה ראשונית שתוצג לך אחרי השמירה. בכניסה הראשונה המשתמש יחויב להחליף אותה.</p>'}`,
      submitLabel: user ? 'שמירה' : 'יצירת משתמש',
      onSubmit: async (form) => {
        const v = formValues(form)
        const role = self ? 'admin' : v.role
        if (user) {
          await adminCall({ action: 'update', id: user.id, full_name: v.full_name, role, lab_id: v.lab_id, client_id: v.client_id })
          toast('המשתמש עודכן')
        } else {
          const res = await adminCall({ action: 'create', email: v.email, full_name: v.full_name, role, lab_id: v.lab_id, client_id: v.client_id })
          setTimeout(() => passwordModal('המשתמש נוצר', res.user.email, res.password), 0)
        }
        load().catch((e) => toast(errorMessage(e)))
      },
    })
    // Show the lab / company picker only for the role that needs it.
    const roleField = root.querySelector('[name="role"]')
    const sync = () => root.querySelectorAll('[data-for]').forEach((l) => (l.hidden = l.dataset.for !== roleField.value))
    roleField.addEventListener('change', sync)
    sync()
  }

  q.addEventListener('input', render)
  roleSel.addEventListener('change', render)
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const user = users.find((u) => u.id === btn.dataset.id)
    switch (btn.dataset.action) {
      case 'new': userModal(null); break
      case 'edit': userModal(user); break
      case 'reset':
        twoStep(btn, async () => {
          try {
            const { password } = await adminCall({ action: 'reset_password', id: user.id })
            passwordModal('הסיסמה אופסה', user.email, password)
            load()
          } catch (err) { toast(errorMessage(err)) }
        }, 'לאישור איפוס')
        break
      case 'delete':
        twoStep(btn, async () => {
          try {
            await adminCall({ action: 'delete', id: user.id })
            toast('המשתמש נמחק')
            load()
          } catch (err) { toast(errorMessage(err)) }
        }, 'לאישור מחיקה')
        break
    }
  })
  await load()
}

// ---------- Data management (view + delete any record) ----------

const yesNo = (v) => (v ? 'כן' : 'לא')
const DATA_TABLES = {
  clients: { label: 'לקוחות', select: 'id, name, contact_person, phone, email, created_at',
    cols: [['name', 'שם'], ['contact_person', 'איש קשר'], ['phone', 'טלפון'], ['email', 'מייל'], ['created_at', 'נוצר', fmtDate]] },
  projects: { label: 'פרויקטים', select: 'id, project_number, name, created_at, client:clients(name)',
    cols: [['project_number', 'מספר'], ['name', 'שם'], ['client.name', 'לקוח'], ['created_at', 'נוצר', fmtDate]], link: (r) => `index.html#/project/${r.id}` },
  test_requests: { label: 'הזמנות בדיקה', select: 'id, request_number, test_date, storage_conditions, tests_completed, created_at, project:projects(id, name)',
    cols: [['request_number', 'מספר'], ['project.name', 'פרויקט'], ['test_date', 'תאריך בדיקה', fmtDate], ['storage_conditions', 'אחסון'], ['tests_completed', 'הושלמו', yesNo]],
    link: (r) => `index.html#/project/${r.project?.id}` },
  tests: { label: 'בדיקות', select: 'id, test_type, status, due_date, performed_by, result_notes, created_at, lab:labs(name), test_request:test_requests(request_number)',
    cols: [['test_request.request_number', 'הזמנה'], ['test_type', 'סוג'], ['lab.name', 'מעבדה'], ['performed_by', 'ביצע'],
      ['due_date', 'יעד', fmtDate], ['status', 'סטטוס', (v) => badge(v, TEST_STATUS)], ['result_notes', 'תוצאה']] },
  reports: { label: 'דוחות', select: 'id, status, completed_tests, total_tests, message, notes, created_at, test_request:test_requests(request_number)',
    cols: [['test_request.request_number', 'הזמנה'], ['status', 'סטטוס', (v) => badge(v, REPORT_STATUS)],
      ['completed_tests', 'הושלמו'], ['total_tests', 'סה"כ'], ['message', 'הודעה'], ['notes', 'הערות']] },
  attachments: { label: 'קבצים', select: 'id, file_type, file_name, size_bytes, storage_path, created_at, project:projects(name)',
    cols: [['file_type', 'סוג', (v) => esc(FILE_TYPE[v] ?? v)], ['file_name', 'שם הקובץ'], ['project.name', 'פרויקט'], ['size_bytes', 'גודל', fmtSize], ['created_at', 'הועלה', fmtDate]] },
  labs: { label: 'מעבדות', select: 'id, name, contact, phone, email, created_at',
    cols: [['name', 'שם'], ['contact', 'איש קשר'], ['phone', 'טלפון'], ['email', 'מייל']] },
}
const pick = (row, path) => path.split('.').reduce((o, k) => o?.[k], row)

Pages.data = async (el, tableName) => {
  const table = DATA_TABLES[tableName] ? tableName : 'clients'
  const cfg = DATA_TABLES[table]
  el.innerHTML = `
    <div class="page-head">
      <div><h1>ניהול נתונים</h1><p class="subtitle">צפייה בכל הרשומות ומחיקה. מחיקה היא סופית.</p></div>
    </div>
    <section class="card">
      <div class="data-toolbar">
        <select id="table" aria-label="טבלה">${options(Object.entries(DATA_TABLES).map(([k, c]) => [k, c.label]), table)}</select>
        <input type="search" id="q" placeholder="חיפוש…" aria-label="חיפוש" style="flex:1;min-width:200px">
        <span class="count" id="count"></span>
      </div>
      <div id="list"><p class="muted">טוען…</p></div>
    </section>`
  const list = el.querySelector('#list')
  const q = el.querySelector('#q')
  let rows = []

  async function load() {
    rows = check(await db.from(table).select(cfg.select).order('created_at', { ascending: false }))
    render()
  }

  function render() {
    const term = q.value.trim().toLowerCase()
    const shown = rows.filter((r) => !term || JSON.stringify(r).toLowerCase().includes(term))
    el.querySelector('#count').textContent = `${shown.length} מתוך ${rows.length}`
    list.innerHTML = `<div class="table-wrap"><table>
      <thead><tr>${cfg.cols.map(([, label]) => `<th>${label}</th>`).join('')}<th></th></tr></thead>
      <tbody>${shown.map((r) => `<tr>
        ${cfg.cols.map(([path, , fmt]) => {
          const v = pick(r, path)
          return `<td>${fmt && v != null ? fmt(v) : val(v)}</td>`
        }).join('')}
        <td class="nowrap">
          ${cfg.link ? `<a class="btn link" href="${cfg.link(r)}">פתיחה</a>` : ''}
          <button class="btn link" data-delete="${r.id}">מחיקה</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="${cfg.cols.length + 1}" class="empty">אין רשומות</td></tr>`}</tbody>
    </table></div>`
  }

  el.querySelector('#table').addEventListener('change', (e) => (location.hash = `#/data/${e.target.value}`))
  q.addEventListener('input', render)
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-delete]')
    if (!btn) return
    twoStep(btn, async () => {
      const row = rows.find((r) => r.id === btn.dataset.delete)
      if (table === 'attachments') await db.storage.from(BUCKET).remove([row.storage_path])
      const { data, error } = await db.from(table).delete().eq('id', row.id).select('id')
      if (error) return toast(errorMessage(error))
      toast(data.length ? 'הרשומה נמחקה' : 'המחיקה נחסמה (אין הרשאה)')
      load().catch((err) => toast(errorMessage(err)))
    }, 'לאישור')
  })
  await load()
}

// ---------- Router ----------

async function route() {
  if (!session || !Profile) return
  const [, name, id] = location.hash.split('/')
  const page = Pages[name] ? name : 'overview'
  document.querySelectorAll('.nav a[data-page]').forEach((a) => a.classList.toggle('active', a.dataset.page === page))
  cleanup?.()
  cleanup = null
  const token = ++routeToken
  const view = document.createElement('div')
  main.replaceChildren(view)
  try {
    const dispose = await Pages[page](view, id)
    if (token === routeToken) cleanup = dispose ?? null
    else dispose?.()
  } catch (err) {
    if (token === routeToken) view.innerHTML = errorBox(err)
  }
}

// ---------- Admin-only session ----------

function showLogin(message) {
  cleanup?.()
  cleanup = null
  main.replaceChildren()
  appView.hidden = true
  loginView.hidden = false
  const errEl = loginForm.querySelector('.error')
  errEl.hidden = !message
  errEl.textContent = message ?? ''
}

async function showView() {
  Profile = null
  applyRoleClasses()
  if (!session) return showLogin()

  const { data } = await db.from('profiles')
    .select('role, client_id, lab_id, must_change_password').eq('id', session.user.id).maybeSingle()
  if (data?.role !== 'admin') {
    return showLogin(`המשתמש ${session.user.email} אינו מנהל מערכת. היכנסו עם חשבון מנהל.`)
  }
  if (data.must_change_password) {
    // The main app handles the forced password change, then the admin can come back.
    location.href = 'index.html'
    return
  }
  Profile = data
  applyRoleClasses()
  loginView.hidden = true
  appView.hidden = false
  document.getElementById('user-email').textContent = session.user.email
  route()
}

db.auth.onAuthStateChange((event, s) => {
  const changed = s?.user?.id !== session?.user?.id
  session = s
  if (changed || event === 'INITIAL_SESSION') setTimeout(showView, 0)
})
window.addEventListener('hashchange', route)
document.getElementById('logout').addEventListener('click', () => db.auth.signOut())

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const errEl = loginForm.querySelector('.error')
  const button = loginForm.querySelector('button[type=submit]')
  errEl.hidden = true
  if (!loginForm.email.value || !loginForm.password.value) {
    errEl.textContent = 'יש למלא מייל וסיסמה'
    errEl.hidden = false
    return
  }
  button.disabled = true
  const { error } = await signIn(loginForm.email.value, loginForm.password.value)
  button.disabled = false
  if (error) {
    errEl.textContent = error.message === 'Invalid login credentials' ? 'מייל או סיסמה שגויים' : error.message
    errEl.hidden = false
  }
})
