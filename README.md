<div dir="rtl">

<p align="center">
  <img src="web/img/buttercup.svg" width="96" alt="Buttercup logo">
</p>

<h1 align="center">Buttercup Lab Services · CRM</h1>

<p align="center">מערכת CRM לניהול לקוחות, פרויקטים, הזמנות בדיקה ודוחות עבור שירותי מעבדה</p>

## מה המערכת עושה

- **לקוחות** – שם הלקוח, איש קשר, טלפון ומייל, וכל הפרויקטים של כל לקוח.
- **פרויקטים** – מספר פרויקט אוטומטי (`PRJ-00001`), שיוך ללקוח, מה נדרש בפרויקט ואילו מעבדות נדרשות.
- **הזמנות בדיקה** – מספר הזמנה אוטומטי (`REQ-00001`), הערות מיוחדות, תנאי אחסון, תאריך בדיקה והאם בוצעו הבדיקות.
- **בדיקות** – סוג בדיקה, מעבדה מבצעת, מי ביצע, תאריך יעד וסטטוס (ממתין / בביצוע / הושלם / נכשל / בוטל).
- **דוחות בזמן אמת** – דוח לכל הזמנה, שמתעדכן אוטומטית בכל שינוי בבדיקות: כמה בדיקות הושלמו, האם כולן בוצעו, הודעת סטטוס והערות. כשכל הבדיקות מסתיימות הדוח מסומן כמוכן.
- **קבצים** – העלאת שרטוטים, תמונות ותעודות COA לכל פרויקט או הזמנה (Supabase Storage).
- **לוח בקרה** – מדדים, דוחות ובדיקות פתוחות לפי יעד, כולל סימון בדיקות באיחור. מתעדכן חי.
- **כניסה והרשמה** – כניסה עם מייל וסיסמה. הרשמה בשני שלבים: (1) שם החברה, איש קשר, טלפון ומייל, כולם שדות חובה; (2) יצירת סיסמה למייל שהוזן.

## תפקידים והרשאות

ההרשאות נאכפות במסד הנתונים (Row Level Security + טריגרים), לא רק בממשק.

| תפקיד | צפייה | עריכה | מחיקה |
|---|---|---|---|
| **מנהל מערכת** (`admin`) | הכל | הכל, כולל משתמשים ותפקידים (פאנל ניהול) | כן |
| **מנהל מעבדה** (`lab_manager`) | הכל | לקוחות, פרויקטים, הזמנות, בדיקות, מעבדות, קבצים | לא |
| **מבצע בדיקות** (`technician`) | הזמנות שיש בהן בדיקות של המעבדה שלו | סטטוס, מבצע ותוצאה של בדיקות המעבדה שלו; הערות לדוח; העלאת קבצים | לא |
| **לקוח** (`client`) | רק הפרויקטים של החברה שלו | — | לא |

- **הרשמה עצמית** דרך הטופס יוצרת תמיד **לקוח**, עם רשומת חברה.
- **מבצע בדיקות** מוגבל גם ברמת העמודה: טריגר חוסם שינוי של סוג הבדיקה, המעבדה או היעד.

### פאנל ניהול (`web/admin.html`)
כניסה נפרדת למנהלי מערכת בלבד. בפאנל:
- **לוח בקרה:** מדדים, בדיקות לפי סטטוס, עומס לפי מעבדה, משתמשים לפי תפקיד וכניסות אחרונות.
- **משתמשים והרשאות:** יצירת משתמש עם סיסמה ראשונית, שינוי תפקיד ושיוך (מעבדה או חברה), איפוס סיסמה ומחיקה.
- **ניהול נתונים:** צפייה ומחיקה של כל רשומה.

פעולות המשתמשים עוברות דרך Edge Function (`supabase/functions/admin-users`). הפונקציה בודקת שהקורא הוא מנהל, ומפתח ה-service role לא מגיע לדפדפן.

### סיסמה ראשונית
משתמש שנוצר בפאנל מקבל סיסמה ראשונית. בכניסה הראשונה המערכת חוסמת את הגישה עד שבוחרים סיסמה אישית, שונה מהסיסמה הראשונית.

## טכנולוגיות

| שכבה | טכנולוגיה |
|---|---|
| ממשק | HTML, CSS ו-JavaScript, בלי שלב build |
| מסד נתונים | Supabase (PostgreSQL) עם Row Level Security |
| זמן אמת | Supabase Realtime |
| קבצים | Supabase Storage (bucket פרטי `lab-files`) |

## מבנה מסד הנתונים

```
clients ──< projects ──< test_requests ──< tests
               │               │
               └──< project_labs >── labs ──< tests (lab_id)
                               │
                               ├── reports      (אחד לכל הזמנה, מתעדכן בטריגר)
                               └──< attachments (גם לפרויקט / לבדיקה)
```

הלוגיקה של הדוחות נמצאת בפונקציה `refresh_report()` ובטריגרים שעל הטבלה `tests`, כך שהדוחות נשארים מעודכנים גם כשהנתונים משתנים מחוץ לממשק.

## הרצה מקומית

1. יוצרים פרויקט ב-[Supabase](https://supabase.com) ומקשרים אליו:
   ```bash
   supabase link --project-ref <project-ref>
   supabase db push --include-seed   # מבנה הטבלאות + נתוני דוגמה
   ```
2. מעתיקים את `web/js/config.example.js` ל-`web/js/config.js` וממלאים את כתובת הפרויקט ואת ה-anon key.
3. פורסים את פונקציית הניהול: `supabase functions deploy admin-users`
4. יוצרים מנהל ראשון (Dashboard ← Authentication ← Add user), ואז:
   ```sql
   update profiles set role = 'admin' where id = (select id from auth.users where email = 'you@company.com');
   ```
   משם ממשיכים לנהל את המשתמשים מפאנל הניהול.
5. מריצים שרת מקומי ופותחים את הדפדפן:
   ```bash
   npx http-server web -p 5173
   ```
   → http://localhost:5173 (מערכת) · http://localhost:5173/admin.html (פאנל ניהול)

## מבנה התיקיות

```
supabase/
  migrations/   מבנה הטבלאות, טריגרים, תפקידים, RLS ו-Storage
  functions/    admin-users – ניהול משתמשים (Edge Function)
  seed.sql      נתוני דוגמה סינתטיים
web/
  index.html    המערכת: כניסה, הרשמה ועמודים לפי תפקיד
  admin.html    פאנל ניהול למנהל מערכת
  css/          עיצוב
  js/           לוגיקה, טפסים ועמודים
  img/          לוגו – פרח נורית
```

</div>

---

**English summary:** A lightweight CRM for a lab-services business: clients, projects, test requests, tests, file uploads (drawings, images, COA) and reports that update in real time. Four roles enforced with Row Level Security (admin, lab manager, technician, client), a separate admin panel with its own login, dashboard and user management (via an Edge Function), a two-step customer sign-up, and initial passwords that must be changed on first login. Built with plain HTML, CSS and JavaScript on top of Supabase (Postgres, RLS, Realtime, Storage).
