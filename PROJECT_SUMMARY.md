# Claude Code Manager (ccm) - סיכום פרויקט

**גרסה / Build:** `2026-07-09 v4 startup-glyph`

## תיאור כללי
סביבת עבודה מרוכזת להרצת הרבה סשני Claude Code במקביל, בתוך **חלון VS Code אחד**,
עם **רשימת טאבים אנכית** בצד שמציגה לכל סשן את **שם התיקייה** ואת **הסטטוס החי**
(עובד / התור שלך / דורש תשומת לב). ללא תהליך רקע, ללא רשת, ללא תוכנה חדשה - רק
הטרמינל המובנה של VS Code + הוקים מבוססי-אירועים של Claude Code שכבר קיימים.

## קבצים עיקריים
| קובץ | תפקיד |
|-------|--------|
| `scripts/ccm.ps1` | המשגר: פותח תיקייה כסשן בטאב הנוכחי, נותן לטאב את שם התיקייה ומריץ `claude` |
| `scripts/install.ps1` | מתקין אידמפוטנטי: רושם את `ccm` ב-PROFILE, ממזג הגדרות VS Code (עם גיבוי), **מפיץ** את ההוקים ומאמת אותם |
| `vscode/settings-snippet.json` | הגדרות הטרמינל של VS Code למיזוג |
| `docs/architecture.md` | איך זה עובד + פרופיל משאבים/אבטחה |
| `docs/vscode-setup.md` | הסבר כל הגדרה + אימות |
| `hooks/` | מקור-האמת של ההוקים; `install.ps1` מעתיק אותם ל-`~/.claude/skills/session-behavior/scripts` |
| `hooks/_model-glyph.sh` | מזהה את המודל מה-transcript (סינון sidechain) ובונה את הכותרת `<ריבוע-מודל> <סטטוס> <תיקייה>` |
| `.gitattributes` | מכריח LF ב-`*.sh` (autocrlf היה מוציא CRLF ב-clone, ו-bash דוחה shebang שנגמר ב-`\r`) |
| `USER_GUIDE.md` / `USER_GUIDE.html` | חוברת הסבר למשתמש (עברית) |
| `ccm-extension/ccm-hub/` | תוסף VS Code (JS, buildless): URI handler `vscode://ccm.hub/session` שפותח טרמינל חדש בחלון הקיים ומריץ Claude |
| `ccm-extension/install-extension.ps1` | side-load של התוסף ל-`~/.vscode/extensions` (ללא npm/admin) |
| `explorer-context-menu/launchers/*.vbs` | מפעילי wscript (ללא חלון קונסולה): `claude-hub.vbs` (יורה את ה-URI), `claude-terminal.vbs` (Windows Terminal+Claude) |
| `explorer-context-menu/install-context-menu.ps1` | מתקין נייד לתפריט הימני (HKCU, ללא admin, מזהה VS Code) |

## טכנולוגיות בשימוש
- VS Code integrated terminal (טאבים אנכיים, `${sequence}` כותרת)
- Claude Code hooks: `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`, `Notification`
- Bash (Git Bash) לסקריפטי ההוקים + PowerShell למשגר/מתקין ול-fallback של הכותרת
- Win32 `AttachConsole`/`SetConsoleTitle` (מסלול fallback ל-Windows Terminal)

## איך זה עובד (בקצרה)
1. **קריאוּת:** `terminal.integrated.tabs.location: "left"` → רשימה אנכית שלא מתכווצת.
2. **סטטוס + מודל:** ההוקים כותבים כותרת `"<ריבוע-מודל> <סטטוס> <תיקייה>"`, למשל `⬛ ⟳ claudeCodeManager`:
   `⟳` עובד (UserPromptSubmit/PostToolUse) · `✓` התור שלך (Stop) · `‼` דורש תשומת לב (Notification).
   ריבועים: `⬛` Opus · `🟦` Fable · `🟥` Haiku · `🟩` Sonnet.
3. **מאיפה המודל:** `_model-glyph.sh` קורא את התור האחרון של ה-assistant מה-transcript
   (מסנן sidechain, כדי שסאב-אייג'נט Haiku לא יצבע טאב של Opus) ומטמין את הריבוע לפי `session_id`.
   `Stop` קורא מחדש בכל תור, ולכן `/model` משתקף מיד.
4. **למה בכותרת ולא בצבע הטאב:** `TerminalOptions.color`/`iconPath` נצרכים פעם אחת ב-`createTerminal()`
   ואין להם setter; `workbench.action.terminal.changeIcon` מתעלם מארגומנטים (vscode#239973 נדחה);
   ו-Claude Code לא שומר את המודל הפעיל בשום קובץ. הכותרת היא המשטח היחיד שיכול לעקוב.
5. **טאב פעיל:** `terminal.tab.activeBorder` + `terminal.integrated.tabs.showActiveTerminal: always`.
6. **הגעת הכותרת לטאב:** בתוך VS Code (`TERM_PROGRAM=vscode`) כתיבת OSC ישירה ל-`/dev/tty`
   (זול); אחרת - fallback ל-`set-tab-title.ps1`. שליטה ע"י `CCM_TITLE_MODE=tty|ps|auto`.
7. הכותרת של Claude עצמו מכובה ע"י `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` (נקרא בהפעלה).

## איך להשתמש
### התקנה / הכנה
```powershell
E:\MAIN_CLAUDE\claudeCodeManager\scripts\install.ps1
```
זה: רושם `ccm` ל-`$PROFILE`, ממזג את הגדרות הטרמינל של VS Code (עם גיבוי), ומאמת הוקים.

### הרצה
1. לפתוח **חלון VS Code חדש** (חובה - כיבוי כותרת Claude נקרא בהפעלה).
2. בטרמינל:
   ```powershell
   ccm E:\path\to\project
   ```
3. פרויקט נוסף = טאב טרמינל חדש (`Ctrl+Shift+5`) + `ccm` שוב.

### פריסה (Deploy)
לא רלוונטי - כלי מקומי. הפצה = repo פרטי ב-GitHub (`idoyan-spec`).

## היסטוריית שינויים
| תאריך | שינוי |
|--------|-------|
| 2026-07-09 | **טאב חדש נצבע מיד (`v4 startup-glyph`):** סשן טרי לא ענה עדיין, ולכן ה-transcript לא יודע מה המודל — נוסף `ccm_configured_model` שנופל חזרה ל-`"model"` מ-settings.json (פרויקט ואז משתמש), ו-`set-title.sh` צובע `✓` כבר ב-SessionStart במקום סטטוס ריק. לפני כן כל טאב בחלון VS Code שנפתח מחדש נראה ריק עד הפרומפט הראשון. בנוסף: `apply_tab_title` תמיד מחזיר 0 ו-`update-title.sh` עוטף ב-`|| true` (רץ תחת `set -e`), ו-`[ -w /dev/tty ]` הוחלף — בלי טרמינל שולט המכשיר "כתיב" אבל `open(2)` נכשל ב-`ENXIO` |
| 2026-07-09 | **סטטוס + מודל על הטאב:** `_model-glyph.sh` חדש (מודל מה-transcript, סינון sidechain, מטמון לפי session), כותרת `<ריבוע-מודל> <סטטוס> <תיקייה>`, נוריות ⟳/✓/‼, מסגרת על הטאב הפעיל; `.gitattributes` שמכריח LF ב-`*.sh` (autocrlf שבר את ההתקנה במחשב שני); `install.ps1` מפיץ הוקים במקום רק לבדוק אותם, ולא כופה יותר `tabs.location=right` |
| 2026-07-09 | **כניסה בקליק אחד מ-Explorer:** תוסף `ccm-hub` (URI handler פותח טרמינל חדש בחלון הקיים — במקום SendKeys שביר), תפריט לחיצה-ימנית נייד (HKCU, ללא admin) עם מפעילי VBS ללא הבהוב, רשימת טאבים הועברה שמאלה, עברית כברירת-מחדל במקלדת |
| 2026-07-07 | גרסה ראשונה: משגר `ccm`, מתקין, הגדרות VS Code, סטטוס בהוקים (⚙/✅/🔔), מסלול OSC ל-VS Code + fallback ל-PowerShell, תיעוד + repo פרטי |
