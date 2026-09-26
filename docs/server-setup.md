# Running the shared server

The server version keeps all bills, contracts, customers and templates in one place so several people can work on
them. Each person signs in with their own account; the Admin creates the accounts. The app itself is served by the
same server.

## 1. Try it on your computer

You need Node.js 22.13 or newer (or Docker).

```bash
npm install
npm run make-env        # writes .env with new secrets (DATA_DIR=./data, http://localhost:8080)
npm run build && npm run build:server
node server/dist/main.js
```

The terminal prints a **setup code**. Open http://localhost:8080 → **Set up the server**: enter the code, create the Admin, then **Import** a backup file from the current
app (Backup / Restore → Download backup file). Add users in **Users**.

For development, run `npm run server` in one terminal and `npm run dev` in another (the app on :5173 talks to the
server on :8080).

## 2. Run it with Docker (on your server)

```bash
git clone https://github.com/anythingvn/billpayment.git && cd billpayment
git checkout feat/role-permissions     # until it is merged (includes the shared server)
npm run make-env                        # needs Node; without Node on the server, see "Making .env without Node" below
# edit .env: PUBLIC_URL=https://bills.your-domain.vn  (DATA_DIR is ignored — Docker uses /data)
mkdir -p data && sudo chown 1000:1000 data   # the container runs as user 1000 and must be able to write here
docker compose up -d --build
docker compose logs app                      # shows the one-time setup code
```

**Making `.env` without Node** (only Docker installed):

```bash
cp .env.example .env && chmod 600 .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 32)|; s|^TOKEN_KEY=.*|TOKEN_KEY=$(openssl rand -base64 32)|" .env
```

Open your address → **Set up the server** asks for the **setup code** printed in that log (only shown while the
server has no users). This stops anyone else from setting it up before you do.

Data lives in `./data` next to `docker-compose.yml` (`billpayment.db`, and `backups/` with one copy per night,
the last 14 kept).

## 3. HTTPS on your domain

Put the server behind HTTPS. With [Caddy](https://caddyserver.com) the whole config is:

```
bills.your-domain.vn {
    reverse_proxy localhost:8080
}
```

Set `PUBLIC_URL=https://bills.your-domain.vn` in `.env` and restart (`docker compose up -d`). Sign-in cookies are
then only sent over HTTPS. `docker-compose.yml` publishes port 8080 on `127.0.0.1` only, so nobody can bypass HTTPS
by going to `http://your-server:8080`; if your reverse proxy runs on another machine, change that line accordingly.

## 4. Company Google Drive

1. In Google Cloud Console (the same project as before is fine): **APIs & Services → Credentials → Create
   credentials → OAuth client ID → Web application**.
2. **Authorized redirect URIs**: `https://bills.your-domain.vn/api/drive/callback` (and
   `http://localhost:8080/api/drive/callback` for trying it locally).
3. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, restart.
4. Sign in as Admin → **Settings → Google Drive → Connect Google Drive**, choose the company Google account.

The server keeps Google's refresh token encrypted with `TOKEN_KEY`; it never reaches anyone's browser.
**Keep `.env` private and never commit it** — it holds the secrets.

## 5. Backups — your responsibility

The server copies its database every night into `data/backups/`. Copy the whole `data/` folder **off the server**
regularly (another machine, Google Drive, a USB disk). The Admin can also download a backup file any time in
**Backup / Restore**.

To move to a new server: stop the old one, copy `data/` and `.env`, start the new one.

## 6. Updating

```bash
git pull
docker compose up -d --build
```

After an update, people may see the old version once; a reload shows the new one.

## Notes

- `SESSION_SECRET` and `TOKEN_KEY` are required; the server refuses to start without them. Changing `TOKEN_KEY`
  means the Admin must connect Google Drive again.
- 5 wrong passwords lock a username for 15 minutes. A forgotten password: the Admin uses **Users → Reset
  password**. If the only Admin forgets theirs, see below.
- Lost Admin password (nobody can sign in as Admin): on the server run
  `docker compose exec app node server/dist/resetPassword.js <username>` (without Docker:
  `node server/dist/resetPassword.js <username>` in the app folder). It asks for a new password, re-enables the
  account and signs it out everywhere; the user must choose their own password at the next sign-in.
- The online GitHub Pages address keeps running the single-user version (data in each browser) until you switch.
