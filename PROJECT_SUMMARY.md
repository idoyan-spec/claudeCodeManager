# Claude Code Manager (ccm) - סיכום פרויקט

**גרסה / Build:** `2026-07-09 22:31 v12 panel-top`

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
| `vscode/keybindings-snippet.json` | קיצורי המקשים לפוקוס: `↑/↓` ברשימת הטאבים, `Ctrl+↑/↓` בתוך טרמינל |
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
2. **סטטוס + מודל:** ההוקים כותבים כותרת `"<ריבוע-מודל> <סטטוס> <תיקייה>"`, למשל `🟨 ⟳ claudeCodeManager`:
   `⟳` עובד (UserPromptSubmit/PostToolUse) · `✓` התור שלך (Stop) · `‼` דורש תשומת לב (Notification).
   ריבועים: `🟨` Opus · `🟦` Fable · `🟥` Haiku · `🟩` Sonnet.
3. **מאיפה המודל:** `_model-glyph.sh` קורא את התור האחרון של ה-assistant מה-transcript
   (מסנן sidechain, כדי שסאב-אייג'נט Haiku לא יצבע טאב של Opus) ומטמין את הריבוע לפי `session_id`.
   `Stop` קורא מחדש בכל תור, ולכן `/model` משתקף מיד.
4. **למה בכותרת ולא בצבע הטאב:** `TerminalOptions.color`/`iconPath` נצרכים פעם אחת ב-`createTerminal()`
   ואין להם setter; `workbench.action.terminal.changeIcon` מתעלם מארגומנטים (vscode#239973 נדחה);
   ו-Claude Code לא שומר את המודל הפעיל בשום קובץ. הכותרת היא המשטח היחיד שיכול לעקוב.
5. **טאב פעיל:** קו ענבר (`terminal.tab.activeBorder`) + רקע מלא. `terminal.tab.activeBorder` הוא הצבע
   **היחיד** שקיים לטאבי טרמינל, ולכן הרקע מגיע מ-`list.*SelectionBackground` הגלובליים (משפיע גם על Explorer).
   הקריטי הוא `list.inactiveSelectionBackground` — כשמקלידים בטרמינל הרשימה לא בפוקוס.
6. **הגעת הכותרת לטאב:** בפועל **תמיד** דרך `set-tab-title.ps1` (`AttachConsole`+`SetConsoleTitle`,
   ו-ConPTY מעביר ל-VS Code כ-`${sequence}`). הכתיבה ל-`/dev/tty` נכשלת תמיד — Claude מריץ הוקים
   בלי טרמינל שולט. `CCM_TITLE_MODE=tty|ps|auto` שולט, וכל קריאה נרשמת בלוג כ-`apply via=`.
7. **התוסף אסור לו לתת `name` ל-`createTerminal`:** זה מקבע `titleSource=Api` ש**גובר לצמיתות**
   על `${sequence}` — הטאב קופא על השם ומתעלם מכל OSC של ההוקים. התוסף שולח OSC בעצמו ואז `claude`.
8. **פוקוס:** לחיצה אחת על טאב (`tabs.focusMode: singleClick`); `↑/↓` ברשימה = `runCommands` של
   `list.focusDown`+`list.select`+`terminal.focus`; `Ctrl+↑/↓` בטרמינל = `focusNext`/`focusPrevious`
   (דורס את `scrollToPrevious/NextCommand`, שלא רלוונטי ב-TUI של Claude).
9. הכותרת של Claude עצמו מכובה ע"י `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` (נקרא בהפעלה).

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
| 2026-07-09 | **`Alt` + פאנל עליון + התקנה ניידת באמת (`v11 alt-arrows`, `v12 panel-top`):** (1) `Alt+↑/↓` לא הגיבו כי **מעולם לא חוברו** — רק `Ctrl` היה. שניהם עכשיו מצביעים לאותה פקודה. אומת בחבילת 1.128 ש-`focusNext`/`focusPrevious` נמצאים ב-`commandsToSkipShell` (159 ערכים) — בלי זה הצירוף היה נבלע ע"י ה-shell ולא מגיע ל-VS Code כלל. (2) **הפאנל העליון**: `workbench.panel.position` נשמר **לכל workspace בנפרד** (`0=left 1=right 2=bottom 3=top`), אבל הדגל של התוסף ישב ב-`globalState` — ולכן רק התיקייה הראשונה אחרי ההתקנה זזה, וכל השאר נשארו למטה לנצח (נמדד: 4 מתוך 5 עם `=2`). עכשיו `workspaceState` בתוסף (0.0.4) + `workbench.panel.defaultLocation: "top"` להגדרות. (3) **המתקין לא היה נייד**: הוא העתיק את קבצי ההוקים ו**לא רשם אותם** ב-`settings.json` — כלומר אף אחד לא קרא להם; הוא רק **התלונן** על `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` במקום לכתוב אותו; והכתיבה היחידה שלו (`Set-Content -Encoding UTF8`) הוסיפה **BOM**. שלושתם תוקנו. הוק הצליל מוצא את תיקיית Windows דרך `[Environment]::GetFolderPath('Windows')` ו**בלי `$`** — ה-shell שמריץ הוקים מרחיב `$` (כך `$HOME` עובד), ולכן `$env:SystemRoot` היה נאכל. אומת על "מחשב מדומה" (USERPROFILE/APPDATA לתיקייה זמנית): הרצה 1 רושמת הכל, 2–3 לא נוגעות; ה-`settings.json` האמיתי נשאר זהה בית-בית |
| 2026-07-09 | **הבהוב אדום על הטאב שצריך אותך (`v10 tab-bell`):** VS Code הופך תו BEL לאייקון סטטוס זמני על הטאב הספציפי (`enableVisualBell` + `bellDuration`, צבע מ-`list.warningForeground`). **הוק לא יכול לצלצל** — אין לו tty; `WriteConsoleW("\a")` דרך AttachConsole מצליח אבל conhost לא מעביר BEL ל-pty. **Claude כן יכול**, כי ה-stdout שלו הוא ה-pty: `preferredNotifChannel: "terminal_bell"` (נקרא בעליית סשן בלבד), יורה על `permission_prompt` ועל `idle_prompt`. בנוסף: `terminal.tab.activeBorder` → אדום זוהר, כי הוא הסימן **היחיד** הקשור לטרמינל הפעיל (`.is-active:before`, רוחב 1px קשיח ב-CSS); הרקע הכחול תלוי ב**בחירה ברשימה** ונעלם בלחיצה על השטח הריק. **תוקן באג במתקין:** `@($raw \| ConvertFrom-Json)` החזיר מערך כאובייקט **בודד**, ה-dedupe לא מצא `.key`, וכל ארבעת הקיצורים נוספו שוב — הקובץ נשמר כ-`{"value":[...],"Count":4}`. עכשיו יש unroll מפורש, סינון לפי `key`, וכתיבה ללא BOM. אומת: שתי הרצות רצופות → 4 קיצורים, 0 כפילויות |
| 2026-07-09 | **טאב נבחר בולט + `‼` שהפסיק לשקר (`v9`):** (1) הרקע של השורה הנבחרת — `terminal.tab.activeBorder` הוא הצבע היחיד שקיים לטאבי טרמינל (נבדק בחבילה של 1.128), ולכן הרקע חייב להגיע מ-`list.*Selection*` הגלובליים; המפתח הקריטי הוא `inactiveSelectionBackground`, כי בזמן הקלדה בטרמינל הרשימה אינה בפוקוס. (2) `Notification` נורה גם על בקשת-הרשאה וגם על "מחכה לך 60 שניות", ולכן כל `✓` הפך ל-`‼` אחרי דקה (בלוג: 145 `done` מול 143 `attention`). `restore-title.sh` מוריד את מקרה ה-idle ל-`✓` לפי `notification_type=idle_prompt`, ובנפילה לפי טקסט ה-`message` (השדה חסר בבקשות הרשאה — claude-code#11964). כל התראה לא-מוכרת **נשארת** `‼` — הכיוון הבטוח. כל מטען נשמר ל-`notifications.log` לאימות |
| 2026-07-09 | **פוקוס אוטומטי על שורת ההקלדה (`v8 tab-focus`, משימה 3):** `focusMode: singleClick` (נמדד בקוד של VS Code 1.128: רק `onMouseClick`/`onMouseDblClick` קוראים אותו — **אף מטפל מקלדת לא**), `↑/↓` ברשימת הטאבים דרך `runCommands` (`list.select` מפעיל את `onDidOpen` שקורא `setActiveInstance` וממקד), ו-`Ctrl+↑/↓` בתוך טרמינל ל-`focusNext`/`focusPrevious`. הפוקוס הוא יחיד, ולכן "חצים ברשימה **וגם** סמן בשורה" בלתי אפשרי מעבר ללחיצה הראשונה — ומכאן פיצול המקשים. `install.ps1` מקבל שלב 4 שממזג `keybindings.json` (dedupe לפי key+command+when) |
| 2026-07-09 | **הטאבים של התוסף היו קפואים (`v6 no-api-name`) — הבאג האמיתי:** `createTerminal({name})` מקבע `titleSource=Api`, ו-VS Code נותן ל-Api עדיפות **קבועה** על `${sequence}` — כלומר כל כותרת OSC שההוקים כתבו נזרקה. התסמין הטעה: האייקון עבד, המסגרת עבדה, ו-`GetConsoleTitle` על ה-shell החי החזיר בדיוק `⬛ ✓ קליקיט` — אבל הטאב הראה `קליקיט`. ההוכחה: טרמינל רגיל (`Ctrl+Shift+5`) באותו חלון, ללא `name`, הציג `🟥 ✓ הקלטה לקלוד`. התוסף (0.0.3) כבר לא מעביר `name` ושולח OSC בעצמו לפני `claude`. בנוסף (`v5`): הוסר ה-gate על `TERM_PROGRAM` ונוסף `apply via=tty\|ps\|failed` ללוג — נמדד ש-`/dev/tty` **תמיד נכשל** (הוקים רצים בלי טרמינל שולט), וש-`TERM_PROGRAM=vscode` דווקא כן מוגדר, מה שגרם לענף מת להיראות כאילו הוא זה שעובד |
| 2026-07-09 | **טאב חדש נצבע מיד (`v4 startup-glyph`):** סשן טרי לא ענה עדיין, ולכן ה-transcript לא יודע מה המודל — נוסף `ccm_configured_model` שנופל חזרה ל-`"model"` מ-settings.json (פרויקט ואז משתמש), ו-`set-title.sh` צובע `✓` כבר ב-SessionStart במקום סטטוס ריק. לפני כן כל טאב בחלון VS Code שנפתח מחדש נראה ריק עד הפרומפט הראשון. בנוסף: `apply_tab_title` תמיד מחזיר 0 ו-`update-title.sh` עוטף ב-`|| true` (רץ תחת `set -e`), ו-`[ -w /dev/tty ]` הוחלף — בלי טרמינל שולט המכשיר "כתיב" אבל `open(2)` נכשל ב-`ENXIO` |
| 2026-07-09 | **סטטוס + מודל על הטאב:** `_model-glyph.sh` חדש (מודל מה-transcript, סינון sidechain, מטמון לפי session), כותרת `<ריבוע-מודל> <סטטוס> <תיקייה>`, נוריות ⟳/✓/‼, מסגרת על הטאב הפעיל; `.gitattributes` שמכריח LF ב-`*.sh` (autocrlf שבר את ההתקנה במחשב שני); `install.ps1` מפיץ הוקים במקום רק לבדוק אותם, ולא כופה יותר `tabs.location=right` |
| 2026-07-09 | **כניסה בקליק אחד מ-Explorer:** תוסף `ccm-hub` (URI handler פותח טרמינל חדש בחלון הקיים — במקום SendKeys שביר), תפריט לחיצה-ימנית נייד (HKCU, ללא admin) עם מפעילי VBS ללא הבהוב, רשימת טאבים הועברה שמאלה, עברית כברירת-מחדל במקלדת |
| 2026-07-07 | גרסה ראשונה: משגר `ccm`, מתקין, הגדרות VS Code, סטטוס בהוקים (⚙/✅/🔔), מסלול OSC ל-VS Code + fallback ל-PowerShell, תיעוד + repo פרטי |
