Pages.clients = async (el) => {
  el.innerHTML = `
    <div class="page-head">
      <div><h1>לקוחות</h1><p class="subtitle">כל הלקוחות ואנשי הקשר</p></div>
      <button class="btn primary" data-action="new">+ לקוח חדש</button>
    </div>
    <section class="card">
      <div class="toolbar"><input type="search" id="q" placeholder="חיפוש לפי שם, איש קשר, מייל או טלפון…" aria-label="חיפוש"></div>
      <div id="list"><p class="muted">טוען…</p></div>
    </section>`
  const list = el.querySelector('#list')
  const q = el.querySelector('#q')
  let clients = []

  async function load() {
    clients = check(await db.from('clients').select('*, projects(count)').order('name'))
    render()
  }

  function render() {
    const term = q.value.trim().toLowerCase()
    const shown = clients.filter((c) => !term ||
      [c.name, c.contact_person, c.email, c.phone].some((v) => v?.toLowerCase().includes(term)))
    list.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>שם הלקוח</th><th>איש קשר</th><th>טלפון</th><th>מייל</th><th>פרויקטים</th><th></th></tr></thead>
      <tbody>
        ${shown.map((c) => `<tr>
          <td><a href="#/client/${c.id}"><b>${esc(c.name)}</b></a></td>
          <td>${val(c.contact_person)}</td>
          <td class="ltr">${val(c.phone)}</td>
          <td class="ltr">${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : val()}</td>
          <td>${c.projects[0]?.count ?? 0}</td>
          <td><button class="btn link" data-action="edit" data-id="${c.id}">עריכה</button></td>
        </tr>`).join('') || '<tr><td colspan="6" class="empty">לא נמצאו לקוחות</td></tr>'}
      </tbody></table></div>`
  }

  q.addEventListener('input', render)
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]')
    if (btn?.dataset.action === 'new') clientModal(null, load)
    if (btn?.dataset.action === 'edit') clientModal(clients.find((c) => c.id === btn.dataset.id), load)
  })
  await load()
}

Pages.client = async (el, id) => {
  async function load() {
    const client = check(await db.from('clients')
      .select('*, projects(id, project_number, name, requirements, created_at, test_requests(tests_completed))')
      .eq('id', id).single())
    client.projects.sort((a, b) => b.created_at.localeCompare(a.created_at))

    el.innerHTML = `
      <a href="#/clients" class="back">→ חזרה ללקוחות</a>
      <div class="page-head">
        <div><h1>${esc(client.name)}</h1><p class="subtitle">לקוח מאז ${fmtDate(client.created_at)}</p></div>
        <button class="btn ghost" data-action="edit">עריכת לקוח</button>
      </div>
      <section class="card details">
        <div><span class="label">איש קשר</span>${val(client.contact_person)}</div>
        <div><span class="label">טלפון</span><span class="ltr">${val(client.phone)}</span></div>
        <div><span class="label">מייל</span>${client.email ? `<a href="mailto:${esc(client.email)}" class="ltr">${esc(client.email)}</a>` : val()}</div>
        <div><span class="label">פרויקטים</span>${client.projects.length}</div>
      </section>
      <section class="card">
        <div class="section-head"><h2>פרויקטים</h2>
          <button class="btn primary small" data-action="new-project">+ פרויקט חדש</button></div>
        ${client.projects.length === 0 ? '<p class="empty">אין פרויקטים ללקוח זה</p>' : `
        <div class="table-wrap"><table>
          <thead><tr><th>מספר</th><th>שם</th><th>מה נדרש</th><th>הזמנות</th><th>נוצר</th></tr></thead>
          <tbody>${client.projects.map((p) => {
            const done = p.test_requests.filter((r) => r.tests_completed).length
            return `<tr>
              <td class="mono"><a href="#/project/${p.id}">${esc(p.project_number)}</a></td>
              <td><a href="#/project/${p.id}">${val(p.name)}</a></td>
              <td class="clip">${val(p.requirements)}</td>
              <td>${done}/${p.test_requests.length} הושלמו</td>
              <td class="muted">${fmtDate(p.created_at)}</td>
            </tr>`
          }).join('')}</tbody>
        </table></div>`}
      </section>`

    el.querySelector('[data-action="edit"]').onclick = () =>
      clientModal(client, (r) => (r === 'deleted' ? (location.hash = '#/clients') : load()))
    el.querySelector('[data-action="new-project"]').onclick = () =>
      projectModal(null, (pid) => (location.hash = `#/project/${pid}`), client.id).catch((err) => toast(errorMessage(err)))
  }
  await load()
}
