# Online scoreboard (optional)

The game can save everyone's results to a Google Sheet that your group shares. Players sign in with a name and a
password; every hand they play (win, loss or draw) and every game they finish is recorded, together with the computer
level (Easy, Normal or Hard). In the game, **Leaderboard 排行榜** then shows:

- **Leaderboard**: everyone ranked by total score, with games won–lost, win rate, average, best game, hands
  won–lost–drawn, hand win rate, self-picks, times dealt in and biggest hand. Buttons switch between all games and
  games against Easy, Normal or Hard computer players.
- **Hall of Fame**: the record holders (top scorer, best single game, biggest hand, most games won overall and on each
  level, most hands won, most limit hands, most self-picks, chicken champion) and the champion of each special hand,
  plus who won it first
- **Special hands**: how many times each player has won with Full Flush, All Terminals, Thirteen Orphans and
  26 other hands
- **My games**: your record on each level, and your recent games, hands and wins

A game counts as a win when you finish 1st. After every hand the game shows your Win or Loss (and whether you dealt
in), and the game-over screen shows the game's Win or Loss.

The sheet has the same numbers on its **Leaderboard** and **Hall of Fame** tabs, so people can look without opening
the game.

It takes about 10 minutes and it's free. One person (the owner) sets it up once with their Google account.

---

## 1. Create the sheet

1. In Google Drive, open the folder you share with the group.
2. Click **New → Google Sheets → Blank spreadsheet**.
3. Click **Untitled spreadsheet** at the top left and name it **HK Mahjong Scoreboard**.

## 2. Add the script

1. In the sheet, choose **Extensions → Apps Script**. A new tab opens with a file called `Code.gs`.
2. Click **Untitled project** at the top left and name it **HK Mahjong Scoreboard**.
3. Delete everything in `Code.gs`.
4. Open [`server/scoreboard.gs`](server/scoreboard.gs) from this project. On GitHub, use the **Copy raw file**
   button at the top right of the file. Paste it into `Code.gs`.
5. Click **Save** (the disk icon).

## 3. Build the tabs

1. In the toolbar, choose **setup** in the function list (next to **Debug**), then click **Run**.
2. The first time, Google asks for permission:
   - Click **Review permissions** and choose your account.
   - If you see "Google hasn't verified this app", click **Advanced**, then **Go to HK Mahjong Scoreboard (unsafe)**.
     Google shows this warning for any script that you write yourself. It isn't a problem here.
   - If you see checkboxes, tick **Select all**. Then click **Allow** (or **Continue**).
3. Go back to the sheet. It now has the tabs **Players, Games, Wins, Stats, Leaderboard** and **Hall of Fame**.
   After you reload the sheet, a **Mahjong scoreboard** menu also appears.

## 4. Publish the script as a web app

1. In Apps Script, click **Deploy → New deployment**.
2. Click the gear icon next to **Select type** and choose **Web app**.
3. Fill in:
   - **Description**: `Scoreboard`
   - **Execute as**: **Me**
   - **Who has access**: **Anyone**
4. Click **Deploy**. If Google asks for permission again, allow it the same way as in step 3.
5. Copy the **Web app URL**. It starts with `https://script.google.com/macros/s/` and ends with `/exec`.

"Anyone" lets the game talk to the script without each player signing in to Google. The script only does what it was
written to do: create accounts, sign players in, save a player's own wins and games, and send back the leaderboard.
Nobody gets edit access to your sheet.

## 5. Connect the game

Paste the URL into the game, between the quotes on this line near the top of the file:

```html
window.HKMJ_SCOREBOARD_URL = "https://script.google.com/macros/s/…/exec";
```

- **On GitHub**: open `index.html`, click the pencil icon (**Edit this file**), paste the URL, then
  **Commit changes**. Do the same in `src/ui/index.html`, so that the URL stays when the game is rebuilt with
  `node build.js`.
- **On your computer**: open `index.html` (or `HK-Mahjong.html`) in a text editor such as TextEdit or Notepad,
  paste the URL, and save.

Reload the game. The start screen now shows **Leaderboard 排行榜** and **Sign in**.

## 6. Try it

1. Click **Sign in**, type a name and a password, then click **Create account**.
2. Play a game. When you win a hand, a new row appears on the sheet's **Wins** tab. When the game ends, a row appears
   on **Games**, and the game-over screen says "Saved to the scoreboard".
3. Open **Leaderboard 排行榜** in the game to see the tables.

---

## What gets saved

| Tab | One row per… | Columns |
|---|---|---|
| **Players** | player | name, joined, last seen |
| **Wins** | hand a player wins | time, player, game, hand number, Fan, points won, how (discard, self-pick, robbing the Kong…), the full scoring breakdown, hand IDs, limit hand, chicken hand, computer level |
| **Hands** | hand a player plays to the end | time, player, game, hand number, result (Win, Loss or Draw), dealt in, winner, how, Fan, points won or lost, computer level, how the winning hand scored |
| **Games** | finished game | time, player, final score, place, hands played and won, self-picks, biggest win, minimum Fan, game length, computer level, result (Win or Loss) |
| **Stats** | player | formulas: totals, averages, records, one column per special hand, hands won–lost–drawn, and the main numbers for each computer level |
| **Leaderboard** | player | Stats sorted by total score |
| **Hall of Fame** | record / hand | record holders and hand champions (formulas) |

Only the person at the keyboard is recorded. The three computer players are not. Games played while signed out
aren't saved.

If the internet drops during a game, the results wait in the browser and are sent the next time the game can reach
the scoreboard.

## Passwords and privacy

- Passwords never go in the sheet. The game scrambles the password (SHA-256) before it leaves the device. The script
  then adds a random salt, scrambles it again, and keeps it in the script's private settings (Script Properties).
  People who can view the sheet or the folder can't see these settings.
- Anyone who can open the sheet can see player names and scores. Use first names or nicknames.
- This is built for a friendly game, not for a bank. Ask everyone to pick a simple password they don't use for
  anything else.
- Keep edit access to the sheet and the script to yourself. Share the folder or the sheet as **Viewer**.

## Owner tools

Use the **Mahjong scoreboard** menu in the sheet:

- **Reset a player's password…**: for someone who forgot their password. Their scores stay. Next time they type the
  same name with a new password and click **Create account**.
- **Set up or repair the tabs**: rebuilds the headers, formulas and formatting, recreates any tab that was deleted,
  and adds a Stats row for any player who is missing one. It's safe to run at any time and doesn't delete records.

To correct a mistake, edit or delete rows on **Wins** or **Games**. Stats, Leaderboard and Hall of Fame update by
themselves, and so does the game's leaderboard.

To remove a test player, delete their rows on **Players**, **Wins**, **Games** and **Stats**, then use
**Reset a player's password…** so the name can be used again.

## Updating the script later

If you paste in a newer `scoreboard.gs`, publish it as a new version of the same deployment. That keeps the URL:

1. In the sheet, open **Extensions → Apps Script**, replace everything in `Code.gs` with the new file, and click **Save**.
2. Choose **setup** in the function list and click **Run**. This rebuilds the tabs for the new version right away.
   (If you skip it, the first request from the game does the same.) Records are never deleted.
3. **Deploy → Manage deployments**, select the deployment and click the pencil icon.
4. Under **Version**, choose **New version**, then click **Deploy**.

If you use **New deployment** instead, Google creates a new URL, and you have to paste that URL into the game again.

**From version 1 to version 2:** version 1's setup stopped part way on a new sheet (Google gives new tabs 26 columns
and the Stats tab needs more), so the Stats and Leaderboard tabs stayed empty. Players, Games and Wins were still saved.
Version 2 adds the columns it needs, fills in the Stats, Leaderboard and Hall of Fame tabs, adds the Hands tab with a
row for every win already saved, and adds the computer level and Win/Loss to earlier records where it can.

## If something doesn't work

| What you see | What to check |
|---|---|
| No **Leaderboard** or **Sign in** button | The URL in `index.html` must start with `https://script.google.com/` and end with `/exec`, inside the quotes. Reload the page. |
| "Could not reach the scoreboard" | Check the internet connection. In **Manage deployments**, check that **Who has access** is **Anyone**. |
| "The scoreboard is not set up yet" | Run **setup** once in Apps Script (step 3). |
| "The coordinates of the range are outside the dimensions of the sheet" | The sheet still runs version 1 of the script. Update it (see "Updating the script later"). |
| A script change doesn't show up | Publish a new version (see "Updating the script later"). |
| "Please sign in again to save your scores" | The password was reset. Sign in again, or create the account again with the same name. |
| Nothing saved after a game | Check that you were signed in. The game-over screen says whether the game was saved. |

The scoreboard works wherever the game can reach the internet, such as on GitHub Pages. Opening the game file
straight from your computer in a normal browser should work too. Previews that block internet access can't reach it.
