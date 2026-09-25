Pages.project = async (el, id) => {
  let project, labs, files

  async function load() {
    ;[project, labs, files] = await Promise.all([
      db.from('projects')
        .select(`*, client:clients(id, name, contact_person, phone, email),
          project_labs(lab:labs(id, name)),
          test_requests(*, tests(*, lab:labs(name)), reports(*))`)
        .eq('id', id)
        .order('test_date', { referencedTable: 'test_requests', ascending: true })
        .order('created_at', { referencedTable: 'test_requests.tests', ascending: true })
        .single().then(check),
      db.from('labs').select('id, name').order('name').then(check),
      db.from('attachments').select('*').eq('project_id', id).order('created_at', { ascending: false }).then(check),
    ])
    render()
  }

  const reportOf = (r) => (Array.isArray(r.reports) ? r.reports[0] : r.reports)

  function render() {
    const p = project
    el.innerHTML = `
      <a href="#/projects" class="back">→ חזרה לפרויקטים</a>
      <div class="page-head">
        <div><h1><span class="mono">${esc(p.project_number)}</span> · ${esc(p.name ?? '')}</h1>
          <p class="subtitle">לקוח: <a href="#/client/${p.client.id}">${esc(p.client.name)}</a> · נפתח ${fmtDate(p.created_at)}</p></div>
        <button class="btn ghost" data-action="edit-project">עריכת פרויקט</button>
      </div>

      <section class="card details">
        <div><span class="label">איש קשר</span>${val(p.client.contact_person)}</div>
        <div><span class="label">טלפון</span><span class="ltr">${val(p.client.phone)}</span></div>
        <div><span class="label">מייל</span>${p.client.email ? `<a class="ltr" href="mailto:${esc(p.client.email)}">${esc(p.client.email)}</a>` : val()}</div>
        <div><span class="label">מעבדות נדרשות</span><div class="chips">
          ${p.project_labs.map((pl) => `<span class="chip">${esc(pl.lab.name)}</span>`).join('') || val()}</div></div>
        <div class="wide"><span class="label">מה נדרש בפרויקט</span>${val(p.requirements)}</div>
      </section>

      <section class="card">
        <div class="section-head"><h2>הזמנות בדיקה</h2>
          <button class="btn primary small" data-action="new-request">+ הזמנה חדשה</button></div>
        ${p.test_requests.map(renderRequest).join('') || '<p class="empty">אין הזמנות בדיקה בפרויקט זה</p>'}
      </section>

      <section class="card">
        <div class="section-head"><h2>קבצים · שרטוטים, תמונות ו-COA</h2></div>
        <form class="upload" id="upload">
          <label>קובץ<input type="file" name="file" required></label>
          <label>סוג<select name="file_type">${options(Object.entries(FILE_TYPE), 'drawing')}</select></label>
          <label>שיוך להזמנה<select name="test_request_id">
            ${options(p.test_requests.map((r) => [r.id, r.request_number]), '', 'כל הפרויקט')}</select></label>
          <button class="btn primary" type="submit">העלאה</button>
        </form>
        ${files.length === 0 ? '<p class="empty">לא הועלו קבצים</p>' : `
        <div class="table-wrap"><table>
          <thead><tr><th>סוג</th><th>שם הקובץ</th><th>הזמנה</th><th>גודל</th><th>הועלה</th><th></th></tr></thead>
          <tbody>${files.map((f) => `<tr>
            <td><span class="badge badge-file">${esc(FILE_TYPE[f.file_type])}</span></td>
            <td class="ltr">${esc(f.file_name)}</td>
            <td class="mono">${val(p.test_requests.find((r) => r.id === f.test_request_id)?.request_number)}</td>
            <td>${fmtSize(f.size_bytes)}</td>
            <td class="muted">${fmtDate(f.created_at)}</td>
            <td><button class="btn link" data-action="download" data-id="${f.id}">פתיחה</button>
                <button class="btn link" data-action="delete-file" data-id="${f.id}">מחיקה</button></td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      </section>`
  }

  function renderRequest(r) {
    const rep = reportOf(r)
    return `<div class="request">
      <div class="request-head">
        <h3 class="mono">${esc(r.request_number)}</h3>
        ${rep ? badge(rep.status, REPORT_STATUS) : ''}
        ${rep ? progress(rep.completed_tests, rep.total_tests) : ''}
        <span class="spacer"></span>
        <button class="btn link" data-action="edit-request" data-id="${r.id}">עריכה</button>
        <button class="btn ghost small" data-action="new-test" data-id="${r.id}">+ בדיקה</button>
      </div>
      <div class="request-meta">
        <span><b>תאריך בדיקה</b>${fmtDate(r.test_date)}</span>
        <span><b>תנאי אחסון</b>${val(r.storage_conditions)}</span>
        <span><b>הערות מיוחדות</b>${val(r.special_notes)}</span>
        <span><b>בוצעו כל הבדיקות</b>${r.tests_completed ? 'כן' : 'לא'}</span>
      </div>
      ${r.tests.length ? `<div class="table-wrap"><table>
        <thead><tr><th>סוג בדיקה</th><th>מעבדה</th><th>מי ביצע</th><th>יעד</th><th>סטטוס</th><th>תוצאה</th><th></th></tr></thead>
        <tbody>${r.tests.map((t) => `<tr>
          <td>${esc(t.test_type)}</td>
          <td>${val(t.lab?.name)}</td>
          <td>${val(t.performed_by)}</td>
          <td class="${isOverdue(t) ? 'overdue' : ''}">${fmtDate(t.due_date)}</td>
          <td><select class="inline" data-status="${t.id}" aria-label="סטטוס בדיקה">${options(Object.entries(TEST_STATUS), t.status)}</select></td>
          <td>${val(t.result_notes)}</td>
          <td><button class="btn link" data-action="edit-test" data-id="${t.id}">עריכה</button></td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="empty">אין בדיקות בהזמנה זו</p>'}
      ${rep?.message ? `<div class="request-msg ${rep.all_tests_done ? 'done' : ''}">
        ${esc(rep.message)}${rep.generated_at ? ` · הופק ${fmtDate(rep.generated_at)}` : ''}${rep.notes ? ` · ${esc(rep.notes)}` : ''}</div>` : ''}
    </div>`
  }

  const reload = () => load().catch((err) => toast(errorMessage(err)))
  const findTest = (tid) => project.test_requests.flatMap((r) => r.tests).find((t) => t.id === tid)

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const tid = btn.dataset.id
    switch (btn.dataset.action) {
      case 'edit-project':
        projectModal(project, (r) => (r === 'deleted' ? (location.hash = '#/projects') : reload())).catch((err) => toast(errorMessage(err)))
        break
      case 'new-request': requestModal(null, id, reload); break
      case 'edit-request': requestModal(project.test_requests.find((r) => r.id === tid), id, reload); break
      case 'new-test': testModal(null, tid, labs, reload); break
      case 'edit-test': testModal(findTest(tid), null, labs, reload); break
      case 'download': {
        const f = files.find((x) => x.id === tid)
        const win = window.open('', '_blank') // open synchronously so the popup isn't blocked
        const { data, error } = await db.storage.from(BUCKET).createSignedUrl(f.storage_path, 120)
        if (error) {
          win?.close()
          toast(error.message === 'Object not found' ? 'הקובץ לא נמצא באחסון' : errorMessage(error))
        } else if (win) win.location = data.signedUrl
        break
      }
      case 'delete-file':
        twoStep(btn, async () => {
          const f = files.find((x) => x.id === tid)
          await db.storage.from(BUCKET).remove([f.storage_path])
          const { error } = await db.from('attachments').delete().eq('id', f.id)
          toast(error ? errorMessage(error) : 'הקובץ נמחק')
          reload()
        }, 'לאישור')
        break
    }
  })

  el.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-status]')
    if (!sel) return
    const { error } = await db.from('tests').update({ status: sel.value }).eq('id', sel.dataset.status)
    toast(error ? errorMessage(error) : 'הסטטוס עודכן')
    // Realtime reloads the page with the recalculated report.
  })

  el.addEventListener('submit', async (e) => {
    if (e.target.id !== 'upload') return
    e.preventDefault()
    const form = e.target
    const button = form.querySelector('button')
    const file = form.file.files[0]
    if (!file) return
    button.disabled = true
    button.textContent = 'מעלה…'
    try {
      // Storage keys must be ASCII, so the original (possibly Hebrew) name is kept in the table only.
      const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : ''
      const path = `projects/${id}/${crypto.randomUUID()}${/^[a-z0-9]{1,8}$/.test(ext) ? `.${ext}` : ''}`
      check(await db.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream' }))
      const { error } = await db.from('attachments').insert({
        file_type: form.file_type.value,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        project_id: id,
        test_request_id: form.test_request_id.value || null,
      })
      if (error) {
        await db.storage.from(BUCKET).remove([path])
        throw error
      }
      toast('הקובץ הועלה')
      await load()
    } catch (err) {
      toast(errorMessage(err))
      button.disabled = false
      button.textContent = 'העלאה'
    }
  })

  await load()
  return watchTables(`project-${id}`, ['tests', 'reports', 'test_requests', 'attachments'], reload)
}
