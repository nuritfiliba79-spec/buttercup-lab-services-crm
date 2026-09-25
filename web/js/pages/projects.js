Pages.projects = async (el) => {
  el.innerHTML = `
    <div class="page-head">
      <div><h1>פרויקטים</h1><p class="subtitle">פרויקטים, מעבדות נדרשות והתקדמות הבדיקות</p></div>
      <button class="btn primary staff-only" data-action="new">+ פרויקט חדש</button>
    </div>
    <section class="card">
      <div class="toolbar">
        <input type="search" id="q" placeholder="חיפוש לפי מספר, שם או דרישות…" aria-label="חיפוש">
        <select id="client" class="staff-only" aria-label="סינון לפי לקוח"></select>
        <label class="check-inline"><input type="checkbox" id="only-new"> 📎 רק עם קבצים חדשים</label>
      </div>
      <div id="list"><p class="muted">טוען…</p></div>
    </section>`
  const list = el.querySelector('#list')
  const q = el.querySelector('#q')
  const clientSel = el.querySelector('#client')
  const onlyNew = el.querySelector('#only-new')
  let projects = []
  let views = new Map()

  async function load() {
    views = await loadProjectViews()
    projects = check(await db.from('projects')
      .select(`id, project_number, name, requirements, created_at, client:clients(id, name),
        project_labs(lab:labs(name)), test_requests(tests_completed),
        attachments(id, created_at, uploaded_by)`)
      .order('created_at', { ascending: false }))
    const clients = [...new Map(projects.map((p) => [p.client.id, p.client.name]))]
      .sort((a, b) => a[1].localeCompare(b[1], 'he'))
    const current = clientSel.value
    clientSel.innerHTML = options(clients, current, 'כל הלקוחות')
    render()
  }

  function render() {
    const term = q.value.trim().toLowerCase()
    const shown = projects.filter((p) =>
      (!clientSel.value || p.client.id === clientSel.value) &&
      (!onlyNew.checked || p.attachments.some((f) => isNewFile(f, views.get(p.id)))) &&
      (!term || [p.project_number, p.name, p.requirements].some((v) => v?.toLowerCase().includes(term))))
    list.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>מספר</th><th>שם הפרויקט</th><th>לקוח</th><th>מה נדרש</th><th>מעבדות</th><th>הזמנות</th><th>קבצים</th></tr></thead>
      <tbody>
        ${shown.map((p) => {
          const done = p.test_requests.filter((r) => r.tests_completed).length
          return `<tr>
            <td class="mono"><a href="#/project/${p.id}">${esc(p.project_number)}</a></td>
            <td><a href="#/project/${p.id}"><b>${val(p.name)}</b></a></td>
            <td><a href="#/client/${p.client.id}">${esc(p.client.name)}</a></td>
            <td class="clip">${val(p.requirements)}</td>
            <td><div class="chips">${p.project_labs.map((pl) => `<span class="chip">${esc(pl.lab.name)}</span>`).join('') || val()}</div></td>
            <td>${progress(done, p.test_requests.length)}</td>
            <td>${fileBadge(p.attachments, views.get(p.id))}</td>
          </tr>`
        }).join('') || '<tr><td colspan="7" class="empty">לא נמצאו פרויקטים</td></tr>'}
      </tbody></table></div>`
  }

  q.addEventListener('input', render)
  clientSel.addEventListener('change', render)
  onlyNew.addEventListener('change', render)
  el.querySelector('[data-action="new"]').onclick = () =>
    projectModal(null, (pid) => (location.hash = `#/project/${pid}`)).catch((err) => toast(errorMessage(err)))
  await load()
  return watchTables('projects', ['projects', 'clients', 'project_labs', 'test_requests', 'attachments'], (payload) => {
    notifyNewFile(payload)
    load().catch((err) => toast(errorMessage(err)))
  })
}
