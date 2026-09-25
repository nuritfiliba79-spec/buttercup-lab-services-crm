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
        <button class="btn ghost staff-only" data-action="edit-project">עריכת פרויקט</button>
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
          <button class="btn primary small staff-only" data-action="new-request">+ הזמנה חדשה</button></div>
        ${p.test_requests.map(renderRequest).join('') || '<p class="empty">אין הזמנות בדיקה בפרויקט זה</p>'}
      </section>

      <section class="card">
        <div class="section-head"><h2>קבצים</h2></div>
        ${renderUpload(p)}
        ${files.length === 0 ? '<p class="empty">לא הועלו קבצים</p>' : Object.entries(STORAGE_AREAS).map(([bucket, label]) => {
          const inArea = files.filter((f) => (f.bucket ?? 'lab-files') === bucket)
          if (!inArea.length) return ''
          return `<h3 class="files-area">${esc(label)} <span class="muted">(${inArea.length})</span></h3>
          <div class="table-wrap"><table>
            <thead><tr><th>סוג</th><th>שם הקובץ</th><th>שיוך</th><th>גודל</th><th>הועלה</th><th></th></tr></thead>
            <tbody>${inArea.map((f) => `<tr>
              <td><span class="badge badge-file">${esc(FILE_TYPE[f.file_type] ?? f.file_type)}</span></td>
              <td class="ltr">${esc(f.file_name)}</td>
              <td>${linkLabel(f)}</td>
              <td>${fmtSize(f.size_bytes)}</td>
              <td class="muted">${fmtDate(f.created_at)}${f.uploaded_by === Profile.id ? ' · שלך' : ''}</td>
              <td class="nowrap"><button class="btn link" data-action="download" data-id="${f.id}">פתיחה</button>
                ${isAdmin() || f.uploaded_by === Profile.id
                  ? `<button class="btn link" data-action="delete-file" data-id="${f.id}">מחיקה</button>` : ''}</td>
            </tr>`).join('')}</tbody>
          </table></div>`
        }).join('')}
      </section>`
  }

  function renderUpload(p) {
    const choices = uploadChoices()
    if (!choices.length) return ''
    const allTests = p.test_requests.flatMap((r) => r.tests.map((t) => ({ ...t, request_number: r.request_number })))
    // Technicians attach files to their own lab's tests; others may pick any request or test.
    const tests = isTech() ? allTests.filter((t) => t.lab_id === Profile.lab_id) : allTests
    const hint = {
      client: 'הקבצים יישמרו ב"קבצי הלקוח" ויהיו זמינים לצוות המעבדה.',
      technician: 'הקבצים יישמרו ב"נתוני בדיקות וניסויים". הם פנימיים למעבדה ולא מוצגים ללקוח.',
    }[Profile.role] ?? 'דוחות נשמרים ב"דוחות מעבדה", נתוני בדיקה וקבצי ניסוי נשמרים ב"נתוני בדיקות וניסויים", ושאר הקבצים ב"קבצי פרויקט".'
    return `<form class="upload" id="upload">
      <label>קובץ<input type="file" name="file" required></label>
      <label>סוג<select name="kind">${options(choices, choices[0][0])}</select></label>
      <label>שיוך<select name="link">
        <option value="">כל הפרויקט</option>
        ${p.test_requests.length ? `<optgroup label="הזמנות">${p.test_requests.map((r) =>
          `<option value="request:${r.id}">${esc(r.request_number)}</option>`).join('')}</optgroup>` : ''}
        ${tests.length ? `<optgroup label="בדיקות">${tests.map((t) =>
          `<option value="test:${t.id}">${esc(t.request_number)} · ${esc(t.test_type)}</option>`).join('')}</optgroup>` : ''}
      </select></label>
      <button class="btn primary" type="submit">העלאה</button>
      <p class="hint upload-hint">${esc(hint)}</p>
    </form>`
  }

  function linkLabel(f) {
    const test = project.test_requests.flatMap((r) => r.tests.map((t) => ({ ...t, request_number: r.request_number })))
      .find((t) => t.id === f.test_id)
    if (test) return `<span class="mono">${esc(test.request_number)}</span> · ${esc(test.test_type)}`
    const req = project.test_requests.find((r) => r.id === f.test_request_id)
    return req ? `<span class="mono">${esc(req.request_number)}</span>` : '<span class="muted">כל הפרויקט</span>'
  }

  function renderRequest(r) {
    const rep = reportOf(r)
    return `<div class="request">
      <div class="request-head">
        <h3 class="mono">${esc(r.request_number)}</h3>
        ${rep ? badge(rep.status, REPORT_STATUS) : ''}
        ${rep ? progress(rep.completed_tests, rep.total_tests) : ''}
        <span class="spacer"></span>
        <button class="btn link staff-only" data-action="edit-request" data-id="${r.id}">עריכה</button>
        <button class="btn ghost small staff-only" data-action="new-test" data-id="${r.id}">+ בדיקה</button>
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
          <td>${canEditTest(t)
            ? `<select class="inline" data-status="${t.id}" aria-label="סטטוס בדיקה">${options(Object.entries(TEST_STATUS), t.status)}</select>`
            : badge(t.status, TEST_STATUS)}</td>
          <td>${val(t.result_notes)}</td>
          <td>${canEditTest(t) ? `<button class="btn link" data-action="edit-test" data-id="${t.id}">${isStaff() ? 'עריכה' : 'עדכון תוצאה'}</button>` : ''}</td>
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
        const { data, error } = await db.storage.from(f.bucket ?? 'lab-files').createSignedUrl(f.storage_path, 120)
        if (error) {
          win?.close()
          toast(error.message === 'Object not found' ? 'הקובץ לא נמצא באחסון' : errorMessage(error))
        } else if (win) win.location = data.signedUrl
        break
      }
      case 'delete-file':
        twoStep(btn, async () => {
          const f = files.find((x) => x.id === tid)
          await removeStoredFiles([f])
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
      const [bucket, fileType] = form.kind.value.split(':')
      const [linkKind, linkId] = form.link.value.split(':')
      const test = linkKind === 'test'
        ? project.test_requests.flatMap((r) => r.tests).find((t) => t.id === linkId) : null
      // Storage keys must be ASCII, so the original (possibly Hebrew) name is kept in the table only.
      const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : ''
      const path = `projects/${id}/${crypto.randomUUID()}${/^[a-z0-9]{1,8}$/.test(ext) ? `.${ext}` : ''}`
      check(await db.storage.from(bucket).upload(path, file, { contentType: file.type || 'application/octet-stream' }))
      const { error } = await db.from('attachments').insert({
        bucket,
        file_type: fileType,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        project_id: id,
        test_request_id: linkKind === 'request' ? linkId : test?.test_request_id ?? null,
        test_id: test?.id ?? null,
        uploaded_by: Profile.id,
      })
      if (error) {
        await db.storage.from(bucket).remove([path])
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
