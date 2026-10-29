# Forge: workout tracker for iPhone

A free, offline workout tracker that runs in Safari and installs to your home screen like a native app. No account, no server, no subscription. All data stays on your phone.

## Put it online (free, about 5 minutes)

1. Sign in at github.com and click **New repository**. Name it `forge`, set it to **Public**, and click **Create repository**.
2. On the new repo page click **uploading an existing file**. Drag in everything from this folder: `index.html`, `app.css`, `app.js`, `data.js`, `sw.js`, `manifest.webmanifest` and the whole `icons` folder. Click **Commit changes**.
3. Go to **Settings > Pages**. Under *Build and deployment* choose **Deploy from a branch**, pick `main` and `/ (root)`, then **Save**.
4. After a minute your app is live at `https://YOUR-USERNAME.github.io/forge/`.

## Install on your iPhone

1. Open that link in **Safari** (it has to be Safari).
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. Open Forge from the home screen icon. It runs full screen and works offline in the gym.

Always open it from the home screen icon. iOS keeps storage for installed apps permanently. Data saved in a normal Safari tab can be cleared if you don't visit for a while.

## Updating the app later

Upload the changed files to the repo again, and change `VERSION` in `sw.js` (for example `forge-v2`). Your phone picks up the new version the next time you open the app, or the time after. Your workout data is not affected.

## Back up your data

Go to **More > Export backup** and save the file to iCloud Drive or Files. To restore it, use **More > Restore backup**. **Export spreadsheet** gives you a CSV of every set for Excel or Numbers.

## Features

- **Workout logging:** sets, reps and weight, with the previous session shown inline and auto-filled when you tick a set
- **Set types:** warm-up, normal, drop set and failure (tap the set number to cycle), plus an automatic warm-up generator
- **Rest timer:** starts automatically when you tick a set, with a countdown ring, ±15s buttons, a 3-2-1 beep and an alert when rest is over. You can set a different rest time for each exercise
- **Break and time tracking:** total duration, total rest and active time for every workout
- **Cardio:** time and distance, with pace, longest distance and totals
- **Timed holds** (plank etc.) and **bodyweight** exercises with optional added weight
- **Live PR detection** with confetti, plus estimated 1RM (Epley), rep records (1/3/5/8/10/12) and charts for each exercise
- **Routines:** 5 starter templates, your own templates, "Save as routine" and "Repeat workout"
- **Weekly review:** a grade out of 100, a comparison with last week (workouts, time, volume, sets, cardio, rest), minutes per day, sets per muscle, PRs and coach notes. You can browse back through past weeks
- **Progress:** weekly volume chart, 18-week heatmap, muscle split, body weight trend with a 7-entry average
- **Tools:** plate calculator and 1RM / percentage calculator
- **Look:** warm paper design with Fraunces serif type, automatic light and dark mode, and a barbell on the home screen that loads a bumper plate for every workout you finish this week (tap it to lift)
- **Onboarding:** a three-step welcome that sets your name, units and weekly goal
- **Feel:** haptics, sounds, spring animations, the screen stays awake during workouts, swipe left to delete a set, kg/lb and km/mi
- **65 built-in exercises** plus your own custom ones

## Limits of a free web app on iPhone

- **Haptics** use a Safari trick that needs iOS 18 or newer. iOS gives web apps only one type of light tap, so the patterns are lighter than in native apps.
- **Rest alerts** only play while Forge is on screen. A web app can't send a local notification when it's in the background. Keeping the screen awake (on by default) helps here.
- There's no Apple Health or Apple Watch sync. Those need a paid native App Store app.
