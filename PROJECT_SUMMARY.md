# Claude Code Manager (ccm) - סיכום פרויקט

**גרסה / Build:** `2026-07-09 v3 status-icons`

## תיאור כללי
סביבת עבודה מרוכזת להרצת הרבה סשני Claude Code במקביל, בתוך **חלון VS Code אחד**,
עם **רשימת טאבים אנכית** בצד שמציגה לכל סשן את **שם התיקייה** ואת **הסטטוס החי**
(עובד / התור שלך / דורש תשומת לב). ללא תהליך רקע, ללא רשת, ללא תוכנה חדשה - רק
הטרמינל המובנה של VS Code + הוקים מבוססי-אירועים של Claude Code שכבר קיימים.

## קבצים עיקריים
| קובץ | תפקיד |
|-------|--------|
| `scripts/ccm.ps1` | המשגר: פותח תיקייה כסשן בטאב הנוכחי, נותן לטאב את שם התיקייה ומריץ `claude` |
| `scripts/install.ps1` | מתקין אידמפוטנטי: רושם את `ccm` ב-PROFILE, ממזג הגדרות VS Code (עם גיבוי), מאמת הוקים |
| `vscode/settings-snippet.json` | הגדרות הטרמינל של VS Code למיזוג |
| `docs/architecture.md` | איך זה עובד + פרופיל משאבים/אבטחה |
| `docs/vscode-setup.md` | הסבר כל הגדרה + אימות |
| `hooks/` | עותקי-ייחוס של ההוקים החיים (snapshot, לא הריצה בפועל) |
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
1. **קריאוּת:** `terminal.integrated.tabs.location: "right"` → רשימה אנכית שלא מתכווצת.
2. **סטטוס:** ההוקים כותבים כותרת `"<אימוג'י> <תיקייה>"`:
   `⚙` עובד (UserPromptSubmit/PostToolUse) · `✅` התור שלך (Stop) · `🔔` דורש תשומת לב (Notification).
3. **הגעת הכותרת לטאב:** בתוך VS Code (`TERM_PROGRAM=vscode`) כתיבת OSC ישירה ל-`/dev/tty`
   (זול); אחרת - fallback ל-`set-tab-title.ps1`. שליטה ע"י `CCM_TITLE_MODE=tty|ps|auto`.
4. הכותרת של Claude עצמו מכובה ע"י `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` (נקרא בהפעלה).

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
| 2026-07-09 | **כניסה בקליק אחד מ-Explorer:** תוסף `ccm-hub` (URI handler פותח טרמינל חדש בחלון הקיים — במקום SendKeys שביר), תפריט לחיצה-ימנית נייד (HKCU, ללא admin) עם מפעילי VBS ללא הבהוב, רשימת טאבים הועברה שמאלה, עברית כברירת-מחדל במקלדת |
| 2026-07-07 | גרסה ראשונה: משגר `ccm`, מתקין, הגדרות VS Code, סטטוס בהוקים (⚙/✅/🔔), מסלול OSC ל-VS Code + fallback ל-PowerShell, תיעוד + repo פרטי |
