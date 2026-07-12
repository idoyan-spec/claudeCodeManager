# Claude Code Manager (ccm) - סיכום פרויקט

**גרסה / Build:** `2026-07-13 01:00 v16 explain-selection`

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
| `ccm-extension/ccm-hub/extension.js` | תוסף VS Code (JS, buildless): URI handler `vscode://ccm.hub/session` + **בורר הפרויקטים ב-`Alt+O`** + **שומר הסגירה ב-`Alt+Q`**; פותח טרמינל חדש בחלון הקיים ומריץ Claude |
| `ccm-extension/test-extension.js` | 46 בדיקות מול `vscode` מזויף (`Module._resolveFilename`); שומר על שני האינווריאנטים: אין `name` ל-`createTerminal`, ואין סגירת טרמינל על ספק |
| `ccm-extension/ccm-hub/projects.js` | דירוג "לפי מה שנכנסתי אליו לאחרונה" — Node טהור, ללא `vscode`, ולכן ניתן לבדיקה מחוץ ל-VS Code |
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
10. **בורר הפרויקטים (`Alt+O`):** QuickPick צף עם כל התיקיות תחת `ccmHub.projectsRoot`,
    ממוין לפי `max(MRU של התוסף, mtime של `~/.claude/projects/<cwd-מקודד>/`)`. שני המקורות
    נחוצים: ה-MRU מדויק אך ריק בהתקנה טרייה ועיוור לסשנים שנפתחו דרך `ccm.ps1` או תפריט
    ה-Explorer; ה-mtime של Claude מתעדכן בכל הרצה אמיתית, בלי קשר לדרך ההפעלה.
11. **הקידוד של Claude חד-כיווני:** cwd → שם תיקייה ע"י החלפת כל תו לא-אלפאנומרי ב-`-`.
    אימות במחשב הזה: 15 מתוך 30 תיקיות נמצאו בדיוק (ה-15 האחרות — Claude מעולם לא רץ בהן),
    0 התנגשויות. הקידוד **מאבד מידע** (`הקלטה לקלוד` → רצף מקפים), ולכן משתמשים בו **רק קדימה**,
    מתיקייה אמיתית שנמצאה בדיסק. גם `\` וגם `/` הופכים ל-`-`, ולכן סגנון המפריד לא משנה.
12. **mtime של תיקייה לא מספיק:** ב-NTFS ה-mtime של תיקייה זז כשנוצר בה קובץ, אבל **לא**
    כשמוסיפים לקובץ קיים — וסשן Claude ארוך הוא הוספה אחת ארוכה ל-`.jsonl` בודד. לכן לוקחים
    את ה-mtime החדש ביותר מבין התיקייה **והתמלילים שבה**. נמדד: תיקייה עם סשן **חי באותו רגע**
    דיווחה `8h ago` לפי ה-mtime של התיקייה בלבד.
13. **`Alt+O` חייב להיות ב-`commandsToSkipShell`:** הקשה בטרמינל בפוקוס נשלחת ל-shell אלא אם
    מזהה הפקודה נמצא ברשימה, ופקודה מותאמת אישית אף פעם לא ברשימת 159 ברירות-המחדל — בלי זה
    PowerShell היה בולע את הצירוף והחלון פשוט לא היה נפתח. אומת בחבילת 1.128:
    `let t = new Set(defaults); … t.add(r)` — מערך המשתמש **ממוזג** לתוך ברירות המחדל
    (קידומת `-` מסירה). התוסף מוסיף את המזהה באופן אידמפוטנטי ב-`activate()`, ולא דרך מיזוג
    ההגדרות של המתקין — כי המתקין דורס מפתח **בשלמותו** והיה מוחק מזהים שהמשתמש הוסיף.
14. **`Alt+O` פנוי:** 0 קישורים בחבילת 1.128 (לעומת `Alt+P` שיש לו 3), 0 בקובץ הקיצורים של
    המשתמש, ולא מנמוניקה של תפריט. הקיצור נשלח עם התוסף (`contributes.keybindings`) ולכן נייד.
    `Alt+Q` (`primary:559`) נבחר באותה שיטה. `Alt+W` (`565`) נראה פנוי ואינו — הוא
    `toggleFindWholeWord` תחת `when: findVisible`, שנכון בדיוק כשטרמינל בפוקוס.
15. **אין `onWillCloseTerminal`:** ל-API של תוספים יש `onDidCloseTerminal` **בלבד** (0 תוצאות
    ל-`onWillCloseTerminal` ב-extension host של 1.128). לכן תוסף **לא יכול** להציב דיאלוג
    משלו לפני כפתור הפח. כל התכנון של שומר-הסגירה נגזר מהעובדה הזאת.
16. **מה כן קיים — `confirmOnKill`:** כל מסלולי ההריגה המובנים (פח, קליק-אמצעי, `Kill Terminal`,
    `Kill All`) עוברים דרך `safeDisposeTerminal`, שמותנה בו. ברירת המחדל `"editor"` מאשרת רק
    טרמינלים באזור העורך — כלומר **לא** את שלנו, שכולם ב-panel. התוסף קובע `"always"`, ורק אם
    ל-`inspect().globalValue` אין ערך, כדי לא לדרוס `"never"` מכוון של המשתמש. עוד תנאי שם:
    `hasChildProcesses` — טרמינל בטל בשורת פרומפט נסגר בשקט גם ב-`"always"`.
17. **`Alt+Q` — הסגירה שכן שלנו:** `showWarningMessage({modal:true})` עם *גבה וסגור / סגור /
    השאר פתוח*, כש-"השאר" נושא `isCloseAffordance: true` כך ש-`Esc` וה-`X` נפתרים אליו.
    הדיאלוג **נוקב בשם התיקייה** שהוא עומד לסגור: שתי כניסות התפריט פועלות על
    `activeTerminal`, ועמימות שהמשתמש רואה ועונה עליה "השאר" עדיפה על סשן שנהרג בשקט.
18. **המתנה לגיבוי דרך כותרת הטאב:** VS Code מעביר את הכותרת המפוענחת ל-extension host
    (`onAnyInstanceTitleChange → $acceptTerminalTitleChange`), כך ש-`Terminal.name` הוא קריאה
    חיה של הגליף שההוקים כתבו. הסדר הוא כל הטריק: **קודם מחכים ל-`⟳`** — ברגע השליחה הטאב עוד
    נושא `✓` **ישן**, והמתנה ל-`✓` הייתה סוגרת מיידית בלי לגבות כלום; רק אחר כך מחכים ש-`✓`
    יעמוד ב-3 דגימות רצופות, כי `Stop` יכול לירות בין שתי קריאות כלי.
19. **האינווריאנט:** `backupThenClose` סוגר את הטרמינל בתוצאה **אחת בדיוק** — `done`. timeout,
    ביטול, `‼`, טרמינל שמת מעצמו — כולם משאירים אותו פתוח ומסבירים למה. פיצ'ר שנועד למנוע
    אובדן טרמינל חייב להיכשל לכיוון של טרמינל שנשאר פתוח. חמש הסיומות נבדקות בנפרד.
20. **ה-undo:** `exitStatus.reason` (`Unknown 0, Shutdown 1, Process 2, User 3, Extension 4`).
    רק `User` מציע שחזור. `Process` = claude יצא לבד, `Shutdown` = VS Code נסגר (מודאל שם היה
    בלתי נסבל), `Extension` = ה-`dispose()` שלנו, שכבר נענה. השחזור פותח `claude --continue`,
    שמחזיר את השיחה מה-`.jsonl` — התהליך נהרג, השיחה לא.

## איך להשתמש
### התקנה / הכנה
```powershell
E:\MAIN_CLAUDE\claudeCodeManager\scripts\install.ps1
```
זה: רושם `ccm` ל-`$PROFILE`, ממזג את הגדרות הטרמינל של VS Code (עם גיבוי), ומאמת הוקים.

### הרצה
1. לפתוח **חלון VS Code חדש** (חובה - כיבוי כותרת Claude נקרא בהפעלה).
2. **`Alt+O`** → בורר צף עם כל הפרויקטים, האחרון שעבדת בו ראשון. Enter פותח והחלון נסגר.
   פרויקט שכבר רץ מסומן `● running` ומקבל פוקוס במקום סשן שני.
3. לחלופין, בטרמינל: `ccm E:\path\to\project` (טאב חדש: `Ctrl+Shift+5`).
4. **`Alt+Q`** (או קליק ימני על הטאב) → *גבה וסגור / סגור / השאר פתוח*. הפח של VS Code מבקש
   אישור בפני עצמו, וסשן שנהרג בכל זאת מוצע לשחזור עם `claude --continue`.

הגדרות: `ccmHub.projectsRoot` (ברירת מחדל `E:\MAIN_CLAUDE`), `ccmHub.claudeCommand`,
`ccmHub.guardTerminalClose` (ברירת מחדל `true`).

### בדיקות
```
node ccm-extension/test-extension.js
```
46 בדיקות מול `vscode` מזויף, ללא VS Code. `ext.timing` הוא תפר-בדיקה שמכווץ את סקר-הגיבוי
מדקות למילישניות.

### פריסה (Deploy)
לא רלוונטי - כלי מקומי. הפצה = repo פרטי ב-GitHub (`idoyan-spec`).

## היסטוריית שינויים
| תאריך | שינוי |
|--------|-------|
| 2026-07-13 | **הסבר-על-סימון ב-Right Ctrl (`v16 explain-selection`):** סימון טקסט בטרמינל + החזקת Right Ctrl → כרטיס הסבר צף בעברית פשוטה; בלי סימון → הקלטה קולית כרגיל. הפיצ'ר חוצה שני ריפו. (1) **מי מחליט:** שירות ה-Python `voice_service.py` (בריפו `הקלטה לקלוד`) הוא היחיד שרואה את Right Ctrl — VS Code לא רואה Ctrl-ימני בודד, ולכן קיצור VS Code לעולם לא היה יכול להפוך מקש אחד לשתי משמעויות. הענף נכנס ב-`ptt_listener` ברגע שסף ההחזקה מושג, **לפני** פתיחת המיקרופון. (2) **זיהוי הסימון בלי סיכון:** לעולם לא Ctrl+C (היה שולח SIGINT ל-Claude). במקום זה: סנטינל ייחודי על הקליפבורד → `Ctrl+Alt+Insert` (התוסף קושר אותו ל-`workbench.action.terminal.copySelection`, no-op בלי סימון, אף פעם לא interrupt) → קריאת הקליפבורד. השתנה = יש סימון. (3) **הקליפבורד מוגן:** הבדיקה רצה בכל Right Ctrl בתוך VS Code, ולכן אם על הקליפבורד יש תוכן לא-טקסטואלי (תמונה/קבצים) — מדלגים לגמרי כדי לא למחוק אותו; טקסט נשמר ומוחזר. `Insert` אינו מקש-תו ולכן לא נבלע כ-AltGr. (4) **המנוע:** `explain.py` שולח ל-`gemini-flash-lite-latest` (alias שלא פורש), עברית פשוטה ולא-טכנית, ~1–1.5 שניות. המפתח נשלף מ-bws בזמן ריצה ונשמר ב-RAM בלבד, לעולם לא על דיסק. (5) **התצוגה:** Python כותב `{original, explanation}` לקובץ זמני ויורה `vscode://ccm.hub/explain?f=…`; התוסף קורא, מציג כרטיס Webview צף RTL (כפתור ✕, נסגר ב-Esc וב-blur כשלוחצים על הטרמינל), ומוחק את הקובץ. הפלט תמיד RTL תקין — זה הכאב האמיתי של "עברית הפוכה" שנפתר. (6) **על ההיפוך:** הבחירה מ-xterm.js היא בסדר לוגי (רק התצוגה LTR), ולכן לא הופכים בכוח (היה משבש טקסט תקין) — המנוע מתבקש לפרש עברית משובשת, ונבדק שהוא מצליח. אומת: 60 בדיקות עוברות (8 חדשות), `explain.py` מול Gemini חי, זיהוי `code.exe` + קליפבורד עובדים. **דורש `Reload Window`** להפעלת התוסף 0.0.8 |
| 2026-07-12 | **`Alt+O`/`Alt+Q` לא נתפסו כשהמקלדת בעברית (`v15 keycode-dispatch`):** התלונה "Alt+O עדיין לא עובד". החיווט היה תקין לגמרי — ה-log של extension host אישר ש-`ccm.hub` נטען ב-20:16:57, הקיצור רשום ב-`keybindings.json`, והפקודה ב-`commandsToSkipShell`. הבעיה שלב אחד לפני: **הלחיצה לא הגיעה לקיצור**. הרמז המבחין — חצים (`Alt+↑/↓`, `Ctrl+↑/↓`) עבדו, אותיות (`Alt+O`, `Alt+Q`) לא. ברירת המחדל `keyboard.dispatch: "code"` פותרת קיצור-אות ע"י מציאת המקש הפיזי שמפיק את האות ב**פריסה הפעילה**; בעברית אף מקש לא מפיק "o", אז הקיצור בלתי-פתיר והלחיצה נופלת ל-shell — בעוד חצים חסינים כי אין להם אות. התיקון: `keyboard.dispatch: "keyCode"` (זיהוי לפי מיקום המקש הפיזי, בלתי-תלוי פריסה) ב-`settings.json` החי + ב-`$want` של `install.ps1` לניידות. **דורש `Reload Window`.** התוסף הותקן מחדש ל-`0.0.7` וכל חותמות הגרסה עודכנו |
| 2026-07-10 | **שומר סגירת טרמינל (`v14 close-guard`):** טרמינל כאן הוא שיחה חיה, וקליק אחד על הפח סיים אותה. (1) **אין `onWillCloseTerminal`** — ל-API יש `onDidCloseTerminal` בלבד (0 תוצאות ב-extension host של 1.128), ולכן תוסף **לא יכול** להציב דיאלוג לפני הפח. כל השאר נגזר מזה. (2) **`confirmOnKill`** הוא מה שכן קיים: כל ההריגות המובנות עוברות ב-`safeDisposeTerminal`, וברירת המחדל `"editor"` מדלגת על טרמינלי panel — כלומר על **כולנו**. התוסף קובע `"always"` רק כשאין ל-`globalValue` ערך, כדי לא לדרוס `"never"` מכוון. (3) **`Alt+Q`** הוא הסגירה שכן שלנו: מודאל *גבה וסגור / סגור / השאר פתוח*, כש-"השאר" הוא `isCloseAffordance` ולכן `Esc` נופל אליו, והדיאלוג **נוקב בשם התיקייה** כי שתי כניסות התפריט פועלות על `activeTerminal`. (4) **ההמתנה לגיבוי קוראת את כותרת הטאב**: VS Code מזרים אותה ל-`Terminal.name`, וההוקים כבר כותבים שם `⟳`/`✓`/`‼`. מחכים **קודם ל-`⟳`** — בשליחה הטאב עוד נושא `✓` ישן, והמתנה ל-`✓` הייתה סוגרת מיידית בלי לגבות כלום — ואז ל-`✓` יציב ב-3 דגימות, כי `Stop` יורה בין קריאות כלי. (5) **האינווריאנט**: סוגרים בתוצאה אחת בדיוק, `done`; timeout/ביטול/`‼`/מוות עצמאי משאירים פתוח ומסבירים. (6) **undo**: `exitStatus.reason === User` בלבד מציע שחזור עם `claude --continue` (לא `Shutdown`, לא `Process`, ולא ה-`dispose()` שלנו). `Alt+Q` = `primary:559`, 0 התנגשויות; `Alt+W` נראה פנוי ואינו. אומת: 46 בדיקות עוברות, ומופע VS Code מבודד לגמרי כתב `confirmOnKill: always` + שתי הפקודות ל-`commandsToSkipShell` ללא שגיאות ובלי לגעת ב-`settings.json` האמיתי |
| 2026-07-10 | **בורר פרויקטים צף ב-`Alt+O` (`v13 project-picker`):** QuickPick עם כל התיקיות תחת `E:\MAIN_CLAUDE`, ממוין לפי מתי נכנסת אליהן לאחרונה; Enter פותח טרמינל עם Claude והחלון נסגר. (1) **המיון** הוא `max(MRU של התוסף, mtime של ההיסטוריה של Claude)` — ה-MRU לבדו ריק בהתקנה טרייה ועיוור ל-`ccm.ps1`/תפריט Explorer, וה-mtime לבדו לא יודע מה פתחת דרך הבורר. (2) **קידוד ה-cwd של Claude** (`[^a-zA-Z0-9]` → `-`) **מאבד מידע** — `הקלטה לקלוד` הופך לרצף מקפים ואי אפשר לפענח חזרה; לכן הוא משמש **רק קדימה**, מתיקייה אמיתית בדיסק. אומת: 15/30 התאמות מדויקות, 0 התנגשויות, ו-`\` מול `/` מקודדים זהה. (3) **mtime של תיקייה משקר**: ב-NTFS הוא זז ביצירת קובץ אך **לא** בהוספה לקובץ קיים, וסשן ארוך הוא הוספה אחת ל-`.jsonl` — נמדד שתיקייה עם סשן **חי באותו רגע** דיווחה `8h ago`. הפתרון: ה-mtime המקסימלי של התיקייה **ושל התמלילים**. (4) **הקיצור היה נבלע**: הקשה בטרמינל בפוקוס עוברת ל-shell אלא אם מזהה הפקודה ב-`commandsToSkipShell`, ופקודה מותאמת לעולם אינה ברשימת 159 ברירות-המחדל. אומת ב-1.128 שהמערך של המשתמש **ממוזג** לתוך ברירות המחדל (`new Set(defaults)` ואז `t.add`), ולכן התוסף מוסיף את עצמו אידמפוטנטית ב-`activate()` — **לא** דרך מיזוג ההגדרות של המתקין, שדורס מפתח בשלמותו. (5) `Alt+O` נבחר כי יש לו 0 קישורים בחבילה (ל-`Alt+P` יש 3). (6) פרויקט שכבר רץ מקבל פוקוס במקום סשן כפול. נבדק ב-hard harness עם `vscode` מזויף: 20 בדיקות עוברות, כולל שהבורר עדיין **לא** מעביר `name` ל-`createTerminal` |
| 2026-07-09 | **`Alt` + פאנל עליון + התקנה ניידת באמת (`v11 alt-arrows`, `v12 panel-top`):** (1) `Alt+↑/↓` לא הגיבו כי **מעולם לא חוברו** — רק `Ctrl` היה. שניהם עכשיו מצביעים לאותה פקודה. אומת בחבילת 1.128 ש-`focusNext`/`focusPrevious` נמצאים ב-`commandsToSkipShell` (159 ערכים) — בלי זה הצירוף היה נבלע ע"י ה-shell ולא מגיע ל-VS Code כלל. (2) **הפאנל העליון**: `workbench.panel.position` נשמר **לכל workspace בנפרד** (`0=left 1=right 2=bottom 3=top`), אבל הדגל של התוסף ישב ב-`globalState` — ולכן רק התיקייה הראשונה אחרי ההתקנה זזה, וכל השאר נשארו למטה לנצח (נמדד: 4 מתוך 5 עם `=2`). עכשיו `workspaceState` בתוסף (0.0.4) + `workbench.panel.defaultLocation: "top"` להגדרות. (3) **המתקין לא היה נייד**: הוא העתיק את קבצי ההוקים ו**לא רשם אותם** ב-`settings.json` — כלומר אף אחד לא קרא להם; הוא רק **התלונן** על `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` במקום לכתוב אותו; והכתיבה היחידה שלו (`Set-Content -Encoding UTF8`) הוסיפה **BOM**. שלושתם תוקנו. הוק הצליל מוצא את תיקיית Windows דרך `[Environment]::GetFolderPath('Windows')` ו**בלי `$`** — ה-shell שמריץ הוקים מרחיב `$` (כך `$HOME` עובד), ולכן `$env:SystemRoot` היה נאכל. אומת על "מחשב מדומה" (USERPROFILE/APPDATA לתיקייה זמנית): הרצה 1 רושמת הכל, 2–3 לא נוגעות; ה-`settings.json` האמיתי נשאר זהה בית-בית |
| 2026-07-09 | **הבהוב אדום על הטאב שצריך אותך (`v10 tab-bell`):** VS Code הופך תו BEL לאייקון סטטוס זמני על הטאב הספציפי (`enableVisualBell` + `bellDuration`, צבע מ-`list.warningForeground`). **הוק לא יכול לצלצל** — אין לו tty; `WriteConsoleW("\a")` דרך AttachConsole מצליח אבל conhost לא מעביר BEL ל-pty. **Claude כן יכול**, כי ה-stdout שלו הוא ה-pty: `preferredNotifChannel: "terminal_bell"` (נקרא בעליית סשן בלבד), יורה על `permission_prompt` ועל `idle_prompt`. בנוסף: `terminal.tab.activeBorder` → אדום זוהר, כי הוא הסימן **היחיד** הקשור לטרמינל הפעיל (`.is-active:before`, רוחב 1px קשיח ב-CSS); הרקע הכחול תלוי ב**בחירה ברשימה** ונעלם בלחיצה על השטח הריק. **תוקן באג במתקין:** `@($raw \| ConvertFrom-Json)` החזיר מערך כאובייקט **בודד**, ה-dedupe לא מצא `.key`, וכל ארבעת הקיצורים נוספו שוב — הקובץ נשמר כ-`{"value":[...],"Count":4}`. עכשיו יש unroll מפורש, סינון לפי `key`, וכתיבה ללא BOM. אומת: שתי הרצות רצופות → 4 קיצורים, 0 כפילויות |
| 2026-07-09 | **טאב נבחר בולט + `‼` שהפסיק לשקר (`v9`):** (1) הרקע של השורה הנבחרת — `terminal.tab.activeBorder` הוא הצבע היחיד שקיים לטאבי טרמינל (נבדק בחבילה של 1.128), ולכן הרקע חייב להגיע מ-`list.*Selection*` הגלובליים; המפתח הקריטי הוא `inactiveSelectionBackground`, כי בזמן הקלדה בטרמינל הרשימה אינה בפוקוס. (2) `Notification` נורה גם על בקשת-הרשאה וגם על "מחכה לך 60 שניות", ולכן כל `✓` הפך ל-`‼` אחרי דקה (בלוג: 145 `done` מול 143 `attention`). `restore-title.sh` מוריד את מקרה ה-idle ל-`✓` לפי `notification_type=idle_prompt`, ובנפילה לפי טקסט ה-`message` (השדה חסר בבקשות הרשאה — claude-code#11964). כל התראה לא-מוכרת **נשארת** `‼` — הכיוון הבטוח. כל מטען נשמר ל-`notifications.log` לאימות |
| 2026-07-09 | **פוקוס אוטומטי על שורת ההקלדה (`v8 tab-focus`, משימה 3):** `focusMode: singleClick` (נמדד בקוד של VS Code 1.128: רק `onMouseClick`/`onMouseDblClick` קוראים אותו — **אף מטפל מקלדת לא**), `↑/↓` ברשימת הטאבים דרך `runCommands` (`list.select` מפעיל את `onDidOpen` שקורא `setActiveInstance` וממקד), ו-`Ctrl+↑/↓` בתוך טרמינל ל-`focusNext`/`focusPrevious`. הפוקוס הוא יחיד, ולכן "חצים ברשימה **וגם** סמן בשורה" בלתי אפשרי מעבר ללחיצה הראשונה — ומכאן פיצול המקשים. `install.ps1` מקבל שלב 4 שממזג `keybindings.json` (dedupe לפי key+command+when) |
| 2026-07-09 | **הטאבים של התוסף היו קפואים (`v6 no-api-name`) — הבאג האמיתי:** `createTerminal({name})` מקבע `titleSource=Api`, ו-VS Code נותן ל-Api עדיפות **קבועה** על `${sequence}` — כלומר כל כותרת OSC שההוקים כתבו נזרקה. התסמין הטעה: האייקון עבד, המסגרת עבדה, ו-`GetConsoleTitle` על ה-shell החי החזיר בדיוק `⬛ ✓ קליקיט` — אבל הטאב הראה `קליקיט`. ההוכחה: טרמינל רגיל (`Ctrl+Shift+5`) באותו חלון, ללא `name`, הציג `🟥 ✓ הקלטה לקלוד`. התוסף (0.0.3) כבר לא מעביר `name` ושולח OSC בעצמו לפני `claude`. בנוסף (`v5`): הוסר ה-gate על `TERM_PROGRAM` ונוסף `apply via=tty\|ps\|failed` ללוג — נמדד ש-`/dev/tty` **תמיד נכשל** (הוקים רצים בלי טרמינל שולט), וש-`TERM_PROGRAM=vscode` דווקא כן מוגדר, מה שגרם לענף מת להיראות כאילו הוא זה שעובד |
| 2026-07-09 | **טאב חדש נצבע מיד (`v4 startup-glyph`):** סשן טרי לא ענה עדיין, ולכן ה-transcript לא יודע מה המודל — נוסף `ccm_configured_model` שנופל חזרה ל-`"model"` מ-settings.json (פרויקט ואז משתמש), ו-`set-title.sh` צובע `✓` כבר ב-SessionStart במקום סטטוס ריק. לפני כן כל טאב בחלון VS Code שנפתח מחדש נראה ריק עד הפרומפט הראשון. בנוסף: `apply_tab_title` תמיד מחזיר 0 ו-`update-title.sh` עוטף ב-`|| true` (רץ תחת `set -e`), ו-`[ -w /dev/tty ]` הוחלף — בלי טרמינל שולט המכשיר "כתיב" אבל `open(2)` נכשל ב-`ENXIO` |
| 2026-07-09 | **סטטוס + מודל על הטאב:** `_model-glyph.sh` חדש (מודל מה-transcript, סינון sidechain, מטמון לפי session), כותרת `<ריבוע-מודל> <סטטוס> <תיקייה>`, נוריות ⟳/✓/‼, מסגרת על הטאב הפעיל; `.gitattributes` שמכריח LF ב-`*.sh` (autocrlf שבר את ההתקנה במחשב שני); `install.ps1` מפיץ הוקים במקום רק לבדוק אותם, ולא כופה יותר `tabs.location=right` |
| 2026-07-09 | **כניסה בקליק אחד מ-Explorer:** תוסף `ccm-hub` (URI handler פותח טרמינל חדש בחלון הקיים — במקום SendKeys שביר), תפריט לחיצה-ימנית נייד (HKCU, ללא admin) עם מפעילי VBS ללא הבהוב, רשימת טאבים הועברה שמאלה, עברית כברירת-מחדל במקלדת |
| 2026-07-07 | גרסה ראשונה: משגר `ccm`, מתקין, הגדרות VS Code, סטטוס בהוקים (⚙/✅/🔔), מסלול OSC ל-VS Code + fallback ל-PowerShell, תיעוד + repo פרטי |
