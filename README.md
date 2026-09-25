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
3. יוצרים משתמש ב-Supabase Dashboard ← Authentication ← Users.
4. מריצים שרת מקומי ופותחים את הדפדפן:
   ```bash
   npx http-server web -p 5173
   ```
   → http://localhost:5173

## מבנה התיקיות

```
supabase/
  migrations/   מבנה הטבלאות, טריגרים, RLS ו-Storage
  seed.sql      נתוני דוגמה סינתטיים
web/
  index.html    מעטפת האפליקציה ומסך הכניסה
  css/          עיצוב
  js/           לוגיקה, טפסים ועמודים
  img/          לוגו – פרח נורית
```

</div>

---

**English summary:** A lightweight CRM for a lab-services business: clients, projects, test requests, tests, file uploads (drawings, images, COA) and reports that update in real time. Built with plain HTML, CSS and JavaScript on top of Supabase (Postgres, Row Level Security, Realtime, Storage).
