Pages.dashboard = async (el) => {
  el.innerHTML = `
    <div class="page-head">
      <div><h1>${isTech() ? 'הבדיקות שלי' : 'לוח בקרה'}</h1><p class="subtitle">${
        isStaff() ? 'מעקב אחר הזמנות, בדיקות ודוחות'
        : isTech() ? 'בדיקות המעבדה שלך: עדכון סטטוס, תוצאות והערות לדוחות'
        : 'מצב הבדיקות והדוחות של החברה שלכם, בזמן אמת'}</p></div>
      <span class="live" id="live">מתחבר…</span>
    </div>
    <div id="body"><p class="muted">טוען…</p></div>`
  const body = el.querySelector('#body')
  let flashId = null

  async function load() {
    const [reports, tests, files, views] = await Promise.all([
      db.from('reports')
        .select(`*, test_request:test_requests(request_number, test_date,
          project:projects(id, project_number, name, client:clients(name)))`)
        .order('updated_at', { ascending: false }).then(check),
      db.from('tests')
        .select(`id, test_type, status, due_date, performed_by, lab_id, lab:labs(name),
          test_request:test_requests(request_number, project:projects(id, name))`)
        .order('due_date', { nullsFirst: false }).then(check),
      db.from('attachments')
        .select('id, file_name, file_type, bucket, created_at, uploaded_by, project:projects(id, name, project_number)')
        .order('created_at', { ascending: false }).limit(8).then(check),
      loadProjectViews(),
    ])
    render(reports, tests, files, views)
    flashId = null
  }

  function render(reports, allTests, files, views) {
    // Technicians see whole requests (for context) but the numbers are about their lab's tests.
    const tests = isTech() ? allTests.filter((t) => t.lab_id === Profile.lab_id) : allTests
    const open = tests.filter((t) => ['pending', 'in_progress'].includes(t.status))
    const overdue = open.filter(isOverdue).length
    const stats = [
      [isTech() ? 'בדיקות ממתינות' : 'הזמנות פתוחות',
        isTech() ? tests.filter((t) => t.status === 'pending').length : reports.filter((r) => !r.all_tests_done).length, ''],
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
                <td>${isStaff() || isTech()
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
        <div class="section-head"><h2>${isTech() ? 'בדיקות פתוחות במעבדה שלי' : 'בדיקות פתוחות לפי יעד'}</h2></div>
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
              <td>${canEditTest(t)
                ? `<select class="inline" data-status="${t.id}" aria-label="סטטוס בדיקה">${options(Object.entries(TEST_STATUS), t.status)}</select>`
                : badge(t.status, TEST_STATUS)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}
      </section>

      <section class="card">
        <div class="section-head"><h2>📎 קבצים אחרונים</h2>
          <span class="muted">${files.filter((f) => isNewFile(f, views.get(f.project?.id))).length} חדשים מאז הביקור האחרון בפרויקט</span></div>
        ${files.length === 0 ? '<p class="empty">לא הועלו קבצים</p>' : `
        <div class="table-wrap"><table>
          <thead><tr><th>קובץ</th><th>סוג</th><th>אזור</th><th>פרויקט</th><th>הועלה</th></tr></thead>
          <tbody>${files.map((f) => {
            const fresh = isNewFile(f, views.get(f.project?.id))
            return `<tr class="${fresh ? 'is-new' : ''}">
              <td class="ltr">${esc(f.file_name)}${fresh ? ' <span class="badge badge-new">חדש</span>' : ''}</td>
              <td>${esc(FILE_TYPE[f.file_type] ?? f.file_type)}</td>
              <td>${esc(STORAGE_AREAS[f.bucket] ?? f.bucket)}</td>
              <td><a href="#/project/${f.project?.id}">${esc(f.project?.name ?? f.project?.project_number)}</a></td>
              <td class="muted nowrap">${new Date(f.created_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</td>
            </tr>`
          }).join('')}</tbody>
        </table></div>`}
      </section>`
  }

  body.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-status]')
    if (sel) {
      const { error } = await db.from('tests').update({ status: sel.value }).eq('id', sel.dataset.status)
    sel.blur() // let the live refresh show the recalculated report right away
      toast(error ? errorMessage(error) : 'הסטטוס עודכן')
      return
    }
    const input = e.target.closest('[data-notes]')
    if (!input) return
    const { error } = await db.from('reports').update({ notes: input.value.trim() || null }).eq('id', input.dataset.notes)
    toast(error ? errorMessage(error) : 'ההערה נשמרה')
  })
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-notes]')) e.target.blur()
  })

  await load()
  const liveLoad = idleRunner(body, load) // waits while a note is being typed
  return watchTables('dashboard', ['reports', 'tests', 'test_requests', 'attachments', 'projects', 'clients'], (payload) => {
    notifyNewFile(payload)
    if (payload.table === 'reports') flashId = payload.new?.id ?? null
    liveLoad()
  }, (on) => {
    const live = el.querySelector('#live')
    live.classList.toggle('on', on)
    live.textContent = on ? 'מתעדכן בזמן אמת' : 'מתחבר…'
  })
}
