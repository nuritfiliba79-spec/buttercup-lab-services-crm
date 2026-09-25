-- Synthetic demo data for Buttercum Lab Services CRM

insert into public.labs (name, contact, phone, email) values
  ('מעבדה כימית - רחובות',   'ד"ר יעל כהן',   '08-9411200', 'chem@buttercum-labs.example'),
  ('מעבדה מיקרוביולוגית',     'אבי לוי',       '03-5559012', 'micro@buttercum-labs.example'),
  ('מעבדת חוזק חומרים',       'רונית שמעוני',  '04-8223344', 'materials@buttercum-labs.example'),
  ('מעבדת יציבות ואחסון',     'עומר חדד',      '09-7701122', 'stability@buttercum-labs.example');

insert into public.clients (name, contact_person, phone, email) values
  ('תנובה מזון בע"מ',          'מיכל ברק',     '050-1234567', 'michal.barak@example.com'),
  ('פארמה-טק ישראל',           'יוסי אברהם',   '052-2345678', 'yossi@pharmatech.example'),
  ('בטון הצפון',               'דני רוזן',     '054-3456789', 'dani@betonnorth.example'),
  ('קוסמטיקה טבעית פלוס',      'שירה נחום',    '053-4567890', 'shira@natcosm.example'),
  ('אגרו-גרין',                'עידו פרץ',     '058-5678901', 'ido@agrogreen.example');

insert into public.projects (client_id, name, requirements)
select c.id, p.name, p.req
from (values
  ('תנובה מזון בע"מ',      'בדיקות מדף ליוגורט חדש',   'בדיקות מיקרוביולוגיות ויציבות לאורך 30 יום'),
  ('תנובה מזון בע"מ',      'אנליזת רכיבים - גבינה',    'בדיקת שומן, חלבון ונתרן לתווית תזונתית'),
  ('פארמה-טק ישראל',       'ולידציה לטבליה 500mg',      'בדיקת טוהר, תכולת חומר פעיל ופירוק'),
  ('בטון הצפון',           'בדיקות חוזק לתערובת B40',   'חוזק לחיצה ב-7 ו-28 יום לפי ת"י 26'),
  ('קוסמטיקה טבעית פלוס',  'קרם פנים - בטיחות',         'ספירה מיקרוביאלית, מתכות כבדות ו-pH'),
  ('אגרו-גרין',            'שאריות חומרי הדברה - עגבניות','סריקת שאריות לפי תקן EU')
) as p(client, name, req)
join public.clients c on c.name = p.client;

insert into public.project_labs (project_id, lab_id)
select p.id, l.id
from (values
  ('בדיקות מדף ליוגורט חדש',       'מעבדה מיקרוביולוגית'),
  ('בדיקות מדף ליוגורט חדש',       'מעבדת יציבות ואחסון'),
  ('אנליזת רכיבים - גבינה',        'מעבדה כימית - רחובות'),
  ('ולידציה לטבליה 500mg',          'מעבדה כימית - רחובות'),
  ('ולידציה לטבליה 500mg',          'מעבדת יציבות ואחסון'),
  ('בדיקות חוזק לתערובת B40',       'מעבדת חוזק חומרים'),
  ('קרם פנים - בטיחות',             'מעבדה מיקרוביולוגית'),
  ('קרם פנים - בטיחות',             'מעבדה כימית - רחובות'),
  ('שאריות חומרי הדברה - עגבניות',  'מעבדה כימית - רחובות')
) as x(project, lab)
join public.projects p on p.name = x.project
join public.labs l on l.name = x.lab;

insert into public.test_requests (project_id, special_notes, storage_conditions, test_date)
select p.id, r.notes, r.storage, r.d::date
from (values
  ('בדיקות מדף ליוגורט חדש',       'לדגום מכל אצווה בנפרד',          'קירור 2-6°C',          '2026-09-10'),
  ('בדיקות מדף ליוגורט חדש',       'דגימה חוזרת ביום 30',             'קירור 2-6°C',          '2026-10-10'),
  ('אנליזת רכיבים - גבינה',        null,                              'קירור 2-8°C',          '2026-09-15'),
  ('ולידציה לטבליה 500mg',          'דחוף - הגשה לרגולטור',            'טמפ׳ חדר, יבש, מוגן אור','2026-09-18'),
  ('בדיקות חוזק לתערובת B40',       '6 קוביות 15x15',                  'אמבט אשפרה 20±2°C',    '2026-09-01'),
  ('קרם פנים - בטיחות',             'לבדוק גם אריזה',                  'טמפ׳ חדר',             '2026-09-20'),
  ('שאריות חומרי הדברה - עגבניות',  'דגימה משלושה חממות',              'הקפאה -18°C',          '2026-09-22')
) as r(project, notes, storage, d)
join public.projects p on p.name = r.project;

-- Tests: inserting these fires the report triggers automatically
insert into public.tests (test_request_id, test_type, lab_id, performed_by, due_date, status, result_notes)
select tr.id, t.ttype, l.id, t.who, t.due::date, t.status::public.test_status, t.res
from (values
  -- yogurt, day 0: all completed -> report completed
  ('בדיקות מדף ליוגורט חדש', '2026-09-10', 'ספירה כללית (TPC)',     'מעבדה מיקרוביולוגית', 'אבי לוי',      '2026-09-14', 'completed', 'תקין - <10 CFU/g'),
  ('בדיקות מדף ליוגורט חדש', '2026-09-10', 'שמרים ועובשים',         'מעבדה מיקרוביולוגית', 'נועה גל',      '2026-09-15', 'completed', 'תקין'),
  ('בדיקות מדף ליוגורט חדש', '2026-09-10', 'pH',                    'מעבדת יציבות ואחסון', 'עומר חדד',     '2026-09-12', 'completed', 'pH 4.3'),
  -- yogurt, day 30: not started
  ('בדיקות מדף ליוגורט חדש', '2026-10-10', 'ספירה כללית (TPC)',     'מעבדה מיקרוביולוגית', null,           '2026-10-14', 'pending',   null),
  ('בדיקות מדף ליוגורט חדש', '2026-10-10', 'pH',                    'מעבדת יציבות ואחסון', null,           '2026-10-12', 'pending',   null),
  -- cheese: in progress
  ('אנליזת רכיבים - גבינה',  '2026-09-15', 'אחוז שומן',             'מעבדה כימית - רחובות', 'ד"ר יעל כהן', '2026-09-19', 'completed', '28.4%'),
  ('אנליזת רכיבים - גבינה',  '2026-09-15', 'חלבון (Kjeldahl)',      'מעבדה כימית - רחובות', 'ד"ר יעל כהן', '2026-09-22', 'in_progress', null),
  ('אנליזת רכיבים - גבינה',  '2026-09-15', 'נתרן',                  'מעבדה כימית - רחובות', null,          '2026-09-24', 'pending',   null),
  -- tablet: in progress, one failed
  ('ולידציה לטבליה 500mg',    '2026-09-18', 'HPLC - תכולת חומר פעיל', 'מעבדה כימית - רחובות', 'ליאור מזרחי', '2026-09-23', 'completed', '99.2%'),
  ('ולידציה לטבליה 500mg',    '2026-09-18', 'בדיקת פירוק',           'מעבדה כימית - רחובות', 'ליאור מזרחי', '2026-09-24', 'failed',    'חריגה - 92% ב-30 דק׳, נדרשת חזרה'),
  ('ולידציה לטבליה 500mg',    '2026-09-18', 'יציבות מואצת 40°C/75%', 'מעבדת יציבות ואחסון', 'עומר חדד',    '2026-12-18', 'in_progress', null),
  -- concrete: all completed
  ('בדיקות חוזק לתערובת B40', '2026-09-01', 'חוזק לחיצה 7 יום',      'מעבדת חוזק חומרים',   'רונית שמעוני', '2026-09-08', 'completed', '31.5 MPa'),
  ('בדיקות חוזק לתערובת B40', '2026-09-01', 'חוזק לחיצה 28 יום',     'מעבדת חוזק חומרים',   'רונית שמעוני', '2026-09-29', 'completed', '46.2 MPa - עומד בדרישות'),
  -- cream: pending + one cancelled
  ('קרם פנים - בטיחות',       '2026-09-20', 'ספירה מיקרוביאלית',     'מעבדה מיקרוביולוגית', 'נועה גל',      '2026-09-27', 'in_progress', null),
  ('קרם פנים - בטיחות',       '2026-09-20', 'מתכות כבדות (ICP-MS)',   'מעבדה כימית - רחובות', null,          '2026-09-30', 'pending',   null),
  ('קרם פנים - בטיחות',       '2026-09-20', 'בדיקת אריזה',           'מעבדת יציבות ואחסון', null,           '2026-09-30', 'cancelled', 'בוטל לבקשת הלקוח'),
  -- tomatoes
  ('שאריות חומרי הדברה - עגבניות', '2026-09-22', 'סריקת 400 חומרי הדברה (LC-MS/MS)', 'מעבדה כימית - רחובות', 'ד"ר יעל כהן', '2026-10-02', 'pending', null)
) as t(project, req_date, ttype, lab, who, due, status, res)
join public.projects p on p.name = t.project
join public.test_requests tr on tr.project_id = p.id and tr.test_date = t.req_date::date
left join public.labs l on l.name = t.lab;

update public.reports r set notes = 'נשלח ללקוח במייל'
from public.test_requests tr
join public.projects p on p.id = tr.project_id
where r.test_request_id = tr.id and p.name = 'בדיקות חוזק לתערובת B40';

-- Attachment metadata (placeholder paths - no real files uploaded)
insert into public.attachments (file_type, storage_path, file_name, mime_type, size_bytes, project_id, test_request_id)
select a.ftype::public.attachment_type, a.path, a.fname, a.mime, a.size, p.id, tr.id
from (values
  ('בדיקות חוזק לתערובת B40', 'drawing', 'projects/b40/mix-design.pdf',   'mix-design.pdf',   'application/pdf', 245000),
  ('בדיקות חוזק לתערובת B40', 'image',   'projects/b40/cubes-day28.jpg',  'cubes-day28.jpg',  'image/jpeg',      1830000),
  ('ולידציה לטבליה 500mg',     'coa',     'projects/tablet/api-coa.pdf',   'api-coa.pdf',      'application/pdf', 118000),
  ('קרם פנים - בטיחות',        'coa',     'projects/cream/raw-materials-coa.pdf', 'raw-materials-coa.pdf', 'application/pdf', 96000)
) as a(project, ftype, path, fname, mime, size)
join public.projects p on p.name = a.project
left join lateral (select id from public.test_requests where project_id = p.id order by test_date limit 1) tr on true;
