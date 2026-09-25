Pages.labs = async (el) => {
  el.innerHTML = `
    <div class="page-head">
      <div><h1>מעבדות</h1><p class="subtitle">המעבדות המבצעות ועומס הבדיקות</p></div>
      <button class="btn primary" data-action="new">+ מעבדה חדשה</button>
    </div>
    <section class="card" id="list"><p class="muted">טוען…</p></section>`
  const list = el.querySelector('#list')
  let labs = []

  async function load() {
    labs = check(await db.from('labs').select('*, tests(status)').order('name'))
    list.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>מעבדה</th><th>איש קשר</th><th>טלפון</th><th>מייל</th><th>בדיקות פתוחות</th><th>הושלמו</th><th></th></tr></thead>
      <tbody>${labs.map((l) => {
        const open = l.tests.filter((t) => ['pending', 'in_progress'].includes(t.status)).length
        const done = l.tests.filter((t) => t.status === 'completed').length
        return `<tr>
          <td><b>${esc(l.name)}</b></td>
          <td>${val(l.contact)}</td>
          <td class="ltr">${val(l.phone)}</td>
          <td class="ltr">${l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : val()}</td>
          <td>${open}</td>
          <td>${done}</td>
          <td><button class="btn link" data-action="edit" data-id="${l.id}">עריכה</button></td>
        </tr>`
      }).join('') || '<tr><td colspan="7" class="empty">אין מעבדות</td></tr>'}</tbody>
    </table></div>`
  }

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]')
    if (btn?.dataset.action === 'new') labModal(null, load)
    if (btn?.dataset.action === 'edit') labModal(labs.find((l) => l.id === btn.dataset.id), load)
  })
  await load()
}
