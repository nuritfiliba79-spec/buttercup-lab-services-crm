// Create / edit modals for every entity.

function clientModal(client, onSaved) {
  openModal({
    title: client ? 'עריכת לקוח' : 'לקוח חדש',
    body: `
      <label>שם הלקוח *<input name="name" required value="${esc(client?.name)}"></label>
      <label>איש קשר<input name="contact_person" value="${esc(client?.contact_person)}"></label>
      <div class="row">
        <label>טלפון<input name="phone" type="tel" dir="ltr" value="${esc(client?.phone)}"></label>
        <label>מייל<input name="email" type="email" dir="ltr" value="${esc(client?.email)}"></label>
      </div>`,
    onSubmit: async (form) => {
      const row = formValues(form)
      check(await (client
        ? db.from('clients').update(row).eq('id', client.id)
        : db.from('clients').insert(row)))
      toast('הלקוח נשמר')
      onSaved()
    },
    onDelete: client && (async () => {
      check(await db.from('clients').delete().eq('id', client.id))
      toast('הלקוח נמחק')
      onSaved('deleted')
    }),
  })
}

async function projectModal(project, onSaved, defaultClientId) {
  const [clients, labs] = await Promise.all([
    db.from('clients').select('id, name').order('name').then(check),
    db.from('labs').select('id, name').order('name').then(check),
  ])
  const chosenLabs = new Set(project?.project_labs?.map((pl) => pl.lab.id) ?? [])
  const clientId = project?.client?.id ?? defaultClientId

  openModal({
    title: project ? `עריכת פרויקט ${project.project_number}` : 'פרויקט חדש',
    body: `
      <label>לקוח *<select name="client_id" required>
        ${options(clients.map((c) => [c.id, c.name]), clientId, 'בחרו לקוח…')}</select></label>
      <label>שם הפרויקט<input name="name" value="${esc(project?.name)}"></label>
      <label>מה נדרש בפרויקט<textarea name="requirements" rows="3">${esc(project?.requirements)}</textarea></label>
      <fieldset><legend>מעבדות נדרשות</legend><div class="checks">
        ${labs.map((l) => `<label class="check"><input type="checkbox" name="lab_ids" value="${l.id}"
          ${chosenLabs.has(l.id) ? 'checked' : ''}> ${esc(l.name)}</label>`).join('')}
      </div></fieldset>`,
    onSubmit: async (form) => {
      const row = formValues(form, ['lab_ids'])
      const labIds = new FormData(form).getAll('lab_ids')
      const saved = check(await (project
        ? db.from('projects').update(row).eq('id', project.id)
        : db.from('projects').insert(row)
      ).select('id').single())
      if (project) check(await db.from('project_labs').delete().eq('project_id', saved.id))
      if (labIds.length) {
        check(await db.from('project_labs').insert(labIds.map((lab_id) => ({ project_id: saved.id, lab_id }))))
      }
      toast('הפרויקט נשמר')
      onSaved(saved.id)
    },
    onDelete: project && (async () => {
      // Remove stored files first; the DB rows cascade with the project.
      const files = check(await db.from('attachments').select('storage_path').eq('project_id', project.id))
      if (files.length) await db.storage.from(BUCKET).remove(files.map((f) => f.storage_path))
      check(await db.from('projects').delete().eq('id', project.id))
      toast('הפרויקט נמחק')
      onSaved('deleted')
    }),
  })
}

function requestModal(request, projectId, onSaved) {
  openModal({
    title: request ? `עריכת הזמנה ${request.request_number}` : 'הזמנת בדיקות חדשה',
    body: `
      <label>תאריך בדיקה<input name="test_date" type="date" value="${esc(request?.test_date)}"></label>
      <label>תנאי אחסון<input name="storage_conditions" placeholder="לדוגמה: קירור 2-8°C" value="${esc(request?.storage_conditions)}"></label>
      <label>הערות מיוחדות<textarea name="special_notes" rows="3">${esc(request?.special_notes)}</textarea></label>`,
    onSubmit: async (form) => {
      const row = formValues(form)
      check(await (request
        ? db.from('test_requests').update(row).eq('id', request.id)
        : db.from('test_requests').insert({ ...row, project_id: projectId })))
      toast('ההזמנה נשמרה')
      onSaved()
    },
    onDelete: request && (async () => {
      const files = check(await db.from('attachments').select('storage_path').eq('test_request_id', request.id))
      if (files.length) await db.storage.from(BUCKET).remove(files.map((f) => f.storage_path))
      check(await db.from('test_requests').delete().eq('id', request.id))
      toast('ההזמנה נמחקה')
      onSaved()
    }),
  })
}

// Technicians may only change these columns (also enforced by a DB trigger).
const TECH_TEST_FIELDS = ['status', 'performed_by', 'result_notes']

function testModal(test, requestId, labs, onSaved) {
  const locked = !isStaff() ? 'disabled' : ''
  openModal({
    title: test ? (isStaff() ? 'עריכת בדיקה' : `עדכון תוצאה · ${test.test_type}`) : 'בדיקה חדשה',
    body: `
      <label>סוג בדיקה *<input name="test_type" required value="${esc(test?.test_type)}" ${locked}></label>
      <div class="row">
        <label>מעבדה מבצעת<select name="lab_id" ${locked}>${options(labs.map((l) => [l.id, l.name]), test?.lab_id, 'לא נקבע')}</select></label>
        <label>מי ביצע<input name="performed_by" value="${esc(test?.performed_by)}"></label>
      </div>
      <div class="row">
        <label>יעד<input name="due_date" type="date" value="${esc(test?.due_date)}" ${locked}></label>
        <label>סטטוס<select name="status">${options(Object.entries(TEST_STATUS), test?.status ?? 'pending')}</select></label>
      </div>
      <label>תוצאה / הערות<textarea name="result_notes" rows="3">${esc(test?.result_notes)}</textarea></label>`,
    onSubmit: async (form) => {
      let row = formValues(form)
      if (!isStaff()) row = Object.fromEntries(TECH_TEST_FIELDS.map((k) => [k, row[k] ?? null]))
      check(await (test
        ? db.from('tests').update(row).eq('id', test.id)
        : db.from('tests').insert({ ...row, test_request_id: requestId })))
      toast('הבדיקה נשמרה')
      onSaved()
    },
    onDelete: test && (async () => {
      check(await db.from('tests').delete().eq('id', test.id))
      toast('הבדיקה נמחקה')
      onSaved()
    }),
  })
}

function labModal(lab, onSaved) {
  openModal({
    title: lab ? 'עריכת מעבדה' : 'מעבדה חדשה',
    body: `
      <label>שם המעבדה *<input name="name" required value="${esc(lab?.name)}"></label>
      <label>איש קשר<input name="contact" value="${esc(lab?.contact)}"></label>
      <div class="row">
        <label>טלפון<input name="phone" type="tel" dir="ltr" value="${esc(lab?.phone)}"></label>
        <label>מייל<input name="email" type="email" dir="ltr" value="${esc(lab?.email)}"></label>
      </div>`,
    onSubmit: async (form) => {
      const row = formValues(form)
      check(await (lab
        ? db.from('labs').update(row).eq('id', lab.id)
        : db.from('labs').insert(row)))
      toast('המעבדה נשמרה')
      onSaved()
    },
    onDelete: lab && (async () => {
      check(await db.from('labs').delete().eq('id', lab.id))
      toast('המעבדה נמחקה')
      onSaved()
    }),
  })
}
