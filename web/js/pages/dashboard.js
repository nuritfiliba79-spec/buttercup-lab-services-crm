Pages.dashboard = async (el) => {
  el.innerHTML = `
    <div class="page-head">
      <div><h1>לוח בקרה</h1><p class="subtitle">${isStaff()
        ? 'מעקב אחר הזמנות, בדיקות ודוחות'
        : 'מצב הבדיקות והדוחות של החברה שלכם, בזמן אמת'}</p></div>
      <span class="live" id="live">מתחבר…</span>
    </div>
    <div id="body"><p class="muted">טוען…</p></div>`
  const body = el.querySelector('#body')
  let flashId = null

  async function load() {
    const [reports, tests] = await Promise.all([
      db.from('reports')
        .select(`*, test_request:test_requests(request_number, test_date,
          project:projects(id, project_number, name, client:clients(name)))`)
        .order('updated_at', { ascending: false }).then(check),
      db.from('tests')
        .select(`id, test_type, status, due_date, performed_by, lab:labs(name),
          test_request:test_requests(request_number, project:projects(id, name))`)
        .order('due_date', { nullsFirst: false }).then(check),
    ])
    // Don't wipe a notes field the user is typing in; the next change will refresh.
    if (body.contains(document.activeElement) && document.activeElement.matches('input')) return
    render(reports, tests)
    flashId = null
  }

  function render(reports, tests) {
    const open = tests.filter((t) => ['pending', 'in_progress'].includes(t.status))
    const overdue = open.filter(isOverdue).length
    const stats = [
      ['הזמנות פתוחות', reports.filter((r) => !r.all_tests_done).length, ''],
      ['בדיקות בביצוע', tests.filter((t) => t.status === 'in_progress').length, ''],
      ['בדיקות באיחור', overdue, overdue ? 'warn' : ''],
      ['דוחות מוכנים', reports.filter((r) => r.all_tests_done).length, 'ok'],
    ]

    body.innerHTML = `
      <div class="stats">
        ${stats.map(([label, value, tone]) => `
          <div class="stat ${tone}"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`).join('')}
      </div>

      <section class="card">
        <div class="section-head"><h2>דוחות</h2></div>
        <div class="table-wrap"><table>
          <thead><tr><th>הזמנה</th><th>פרויקט</th><th>לקוח</th><th>התקדמות</th><th>סטטוס</th><th>הודעה</th><th>הערות</th><th>עודכן</th></tr></thead>
          <tbody>
            ${reports.map((r) => {
              const p = r.test_request?.project
              return `<tr class="${r.id === flashId ? 'flash' : ''}">
                <td class="mono">${esc(r.test_request?.request_number)}</td>
                <td><a href="#/project/${p?.id}">${esc(p?.name ?? p?.project_number)}</a></td>
                <td>${val(p?.client?.name)}</td>
                <td>${progress(r.completed_tests, r.total_tests)}</td>
                <td>${badge(r.status, REPORT_STATUS)}</td>
                <td>${val(r.message)}</td>
                <td>${isStaff()
                  ? `<input class="inline" data-notes="${r.id}" value="${esc(r.notes)}" placeholder="הוספת הערה…" aria-label="הערות לדוח">`
                  : val(r.notes)}</td>
                <td class="muted">${fmtDate(r.updated_at)}</td>
              </tr>`
            }).join('') || `<tr><td colspan="8" class="empty">${isStaff()
              ? 'אין דוחות עדיין'
              : 'עדיין אין הזמנות בדיקה לחברה שלכם. ברגע שצוות המעבדה יפתח פרויקט, הוא יופיע כאן.'}</td></tr>`}
          </tbody>
        </table></div>
      </section>

      <section class="card">
        <div class="section-head"><h2>בדיקות פתוחות לפי יעד</h2></div>
        ${open.length === 0 ? '<p class="empty">אין בדיקות פתוחות</p>' : `
        <div class="table-wrap"><table>
          <thead><tr><th>יעד</th><th>סוג בדיקה</th><th>פרויקט</th><th>הזמנה</th><th>מעבדה</th><th>מבצע</th><th>סטטוס</th></tr></thead>
          <tbody>
            ${open.map((t) => `<tr>
              <td class="${isOverdue(t) ? 'overdue' : ''}">${fmtDate(t.due_date)}${isOverdue(t) ? ' · באיחור' : ''}</td>
              <td>${esc(t.test_type)}</td>
              <td><a href="#/project/${t.test_request?.project?.id}">${esc(t.test_request?.project?.name)}</a></td>
              <td class="mono">${esc(t.test_request?.request_number)}</td>
              <td>${val(t.lab?.name)}</td>
              <td>${val(t.performed_by)}</td>
              <td>${badge(t.status, TEST_STATUS)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}
      </section>`
  }

  body.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-notes]')
    if (!input) return
    const { error } = await db.from('reports').update({ notes: input.value.trim() || null }).eq('id', input.dataset.notes)
    toast(error ? errorMessage(error) : 'ההערה נשמרה')
  })
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-notes]')) e.target.blur()
  })

  await load()
  return watchTables('dashboard', ['reports', 'tests', 'test_requests'], (payload) => {
    if (payload.table === 'reports') flashId = payload.new?.id ?? null
    load().catch((err) => toast(errorMessage(err)))
  }, (on) => {
    const live = el.querySelector('#live')
    live.classList.toggle('on', on)
    live.textContent = on ? 'מתעדכן בזמן אמת' : 'מתחבר…'
  })
}
