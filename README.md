# Norwood Reservoir rainfall site

A self-updating website showing rainfall history for the Norwood Reservoir gauge,
built from Environment Agency open data. No coding required to run it — follow
the steps below.

## What's in here

- `docs/` — the website itself (this is what visitors see)
- `scripts/update_data.py` — fetches new rainfall data and rebuilds the charts' data files
- `.github/workflows/update.yml` — tells GitHub to run that script automatically, every hour
- `data/rainfall.db` — the database of all readings (created automatically on first run)

## Setup (one-time, about 5 minutes)

1. **Create a new repository on GitHub.**
   Go to github.com → click the **+** in the top right → **New repository**.
   Give it any name (e.g. `rainfall-site`), leave it **Public**, don't add a
   README/gitignore (this project already has them), then click **Create repository**.

2. **Upload these files.**
   On the new repository's page, click **Add file → Upload files**, then drag
   the entire contents of this folder (not the folder itself — its *contents*:
   `docs`, `scripts`, `.github`, `data`, `README.md`) into the browser window.
   Click **Commit changes**.

3. **Turn on GitHub Pages.**
   Go to the repository's **Settings** tab → **Pages** (left sidebar) →
   under "Build and deployment", set **Source** to `Deploy from a branch`,
   set the branch to `main` and the folder to `/docs`, then click **Save**.
   GitHub will give you a URL like `https://yourusername.github.io/rainfall-site/`
   — that's your live site (it'll show "couldn't load data yet" until step 4 finishes).

4. **Run the first data fetch manually.**
   Go to the **Actions** tab → click **Update rainfall data** in the left list →
   click **Run workflow** (top right) → **Run workflow** again to confirm.
   This does the one-time historical backfill (all readings back to 2003),
   which takes a minute or two. Refresh the Actions page until you see a green
   checkmark.

5. **Check the site.**
   Visit the URL from step 3. You should see charts. From here on, the
   `update.yml` workflow runs automatically every hour and keeps the data current
   — you don't need to do anything else.

## Adding your own domain (optional)

If you buy a domain (from any registrar — Namecheap, GoDaddy, Google Domains,
etc.), you can point it at this site:

1. In the repository, go to **Settings → Pages** and enter your domain under
   "Custom domain", then save.
2. In your domain registrar's DNS settings, add a **CNAME** record pointing your
   domain (or subdomain, e.g. `rainfall.yourdomain.com`) to
   `yourusername.github.io`.
3. It can take up to 24 hours for DNS to update. GitHub will show a checkmark
   next to the domain in Settings once it's verified, and can auto-provision
   HTTPS for it.

## If something goes wrong

- **Actions tab shows a red X:** click into the failed run to see the error
  message, and paste it into a chat with an AI assistant (or back to me) —
  it'll almost always be something simple like a temporary network hiccup on
  the Environment Agency's end, and re-running the workflow fixes it.
- **Site shows "couldn't load data yet":** the first workflow run (step 4)
  probably hasn't finished or hasn't been triggered yet.
