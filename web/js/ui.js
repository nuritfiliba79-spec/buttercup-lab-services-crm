// Shared helpers: Supabase client, labels, formatting, modal, toast.

const db = supabase.createClient(CRM_CONFIG.SUPABASE_URL, CRM_CONFIG.SUPABASE_ANON_KEY)
const BUCKET = 'lab-files'

// Page renderers register here: Pages[name] = async (el, id) => cleanupFn | undefined
const Pages = {}

const TEST_STATUS = { pending: 'ממתין', in_progress: 'בביצוע', completed: 'הושלם', failed: 'נכשל', cancelled: 'בוטל' }
const REPORT_STATUS = { pending: 'ממתין', in_progress: 'בביצוע', completed: 'הושלם' }
const FILE_TYPE = { drawing: 'שרטוט', image: 'תמונה', coa: 'COA', other: 'אחר' }

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

// Escaped value, or a muted dash when empty.
function val(v) {
  return v == null || v === '' ? '<span class="muted">—</span>' : esc(v)
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('he-IL') : '—'
}

function fmtSize(bytes) {
  if (bytes == null) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const today = () => new Date().toISOString().slice(0, 10)

function isOverdue(test) {
  return !!test.due_date && test.due_date < today() && ['pending', 'in_progress'].includes(test.status)
}

function badge(status, labels) {
  return `<span class="badge badge-${esc(status)}">${esc(labels[status] ?? status)}</span>`
}

function progress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return `<div class="progress" title="${done} מתוך ${total}">
    <div class="bar"><span style="width:${pct}%"></span></div><small>${done}/${total}</small></div>`
}

function options(items, selected, placeholder) {
  const first = placeholder != null ? `<option value="">${esc(placeholder)}</option>` : ''
  return first + items.map(([value, label]) =>
    `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`).join('')
}

// Unwraps a Supabase response, throwing its error.
function check({ data, error }) {
  if (error) throw error
  return data
}

function errorMessage(err) {
  if (err?.code === '23503') return 'לא ניתן למחוק: קיימות רשומות שמקושרות לפריט הזה.'
  if (err?.code === '23505') return 'ערך זה כבר קיים במערכת.'
  return err?.message ?? String(err)
}

function errorBox(err) {
  return `<div class="error">${esc(errorMessage(err))}</div>`
}

// Form fields -> object; empty strings become null. Multi-value fields are skipped (read them with getAll).
function formValues(form, skip = []) {
  const out = {}
  for (const [k, v] of new FormData(form)) {
    if (v instanceof File || skip.includes(k)) continue
    out[k] = v === '' ? null : v
  }
  return out
}

function toast(message) {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = message
  document.body.append(el)
  setTimeout(() => el.remove(), 2600)
}

// Arms a button on first click and runs `fn` only on a second click within 4s.
function twoStep(button, fn, armedLabel = 'לחצו שוב לאישור') {
  const label = button.textContent
  if (button.dataset.armed) {
    clearTimeout(Number(button.dataset.armed))
    fn()
    return
  }
  button.textContent = armedLabel
  button.classList.add('armed')
  button.dataset.armed = setTimeout(() => {
    delete button.dataset.armed
    button.textContent = label
    button.classList.remove('armed')
  }, 4000)
}

// Opens a form modal. onSubmit(form) / onDelete() are async; the modal closes when they resolve.
function openModal({ title, body, submitLabel = 'שמירה', onSubmit, onDelete }) {
  const root = document.createElement('div')
  root.className = 'modal-backdrop'
  root.innerHTML = `
    <form class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="סגירה">✕</button></header>
      <div class="modal-body">${body}</div>
      <div class="error" hidden></div>
      <footer>
        ${onDelete ? '<button type="button" class="btn danger" data-delete>מחיקה</button>' : ''}
        <span class="spacer"></span>
        <button type="button" class="btn ghost" data-close>ביטול</button>
        <button type="submit" class="btn primary">${esc(submitLabel)}</button>
      </footer>
    </form>`
  document.body.append(root)

  const form = root.querySelector('form')
  const errEl = root.querySelector('.error')
  const onKey = (e) => e.key === 'Escape' && close()
  function close() {
    root.remove()
    document.removeEventListener('keydown', onKey)
  }
  document.addEventListener('keydown', onKey)
  root.addEventListener('mousedown', (e) => e.target === root && close())
  root.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close))

  async function run(fn) {
    errEl.hidden = true
    const buttons = form.querySelectorAll('button')
    buttons.forEach((b) => (b.disabled = true))
    try {
      await fn()
      close()
    } catch (err) {
      errEl.textContent = errorMessage(err)
      errEl.hidden = false
    } finally {
      buttons.forEach((b) => (b.disabled = false))
    }
  }

  form.onsubmit = (e) => {
    e.preventDefault()
    run(() => onSubmit(form))
  }
  const del = root.querySelector('[data-delete]')
  if (del) del.onclick = () => twoStep(del, () => run(onDelete))

  form.querySelector('input, select, textarea')?.focus()
}

// Subscribes to changes on the given tables and calls `onChange` (debounced). Returns an unsubscribe fn.
function watchTables(name, tables, onChange, onStatus) {
  let timer
  const trigger = (payload) => {
    clearTimeout(timer)
    timer = setTimeout(() => onChange(payload), 150)
  }
  let channel = db.channel(`${name}-${Date.now()}`)
  for (const table of tables) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, trigger)
  }
  channel.subscribe((status) => onStatus?.(status === 'SUBSCRIBED'))
  return () => {
    clearTimeout(timer)
    db.removeChannel(channel)
  }
}
