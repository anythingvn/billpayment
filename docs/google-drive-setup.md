# Google Drive setup (one time, about 10 minutes)

The app saves final bills to **My Drive / <main folder> / <year> / <customer> / <bill number>.pdf**.
For that it needs a free **Google OAuth Client ID** that you create with your own Google account.
Nothing here needs a payment method.

## 1. Project and API
1. Open <https://console.cloud.google.com/> and create a project (for example **billpayment**), or pick an existing one.
2. **APIs & Services → Library → Google Drive API → Enable.**

## 2. Consent screen (Google Auth Platform)
1. **Branding:** app name (e.g. *Phiếu thanh toán*), your email as support and developer contact.
2. **Audience:** *External*. Either add your Google account under **Test users**, or **Publish** the app.
   The only scope used, `drive.file`, does not require Google's app verification.
3. **Data access:** add the scope `https://www.googleapis.com/auth/drive.file`
   ("See, edit, create and delete only the specific Google Drive files you use with this app").

## 3. Client ID
1. **Clients → Create client → Application type: Web application.**
2. **Authorized JavaScript origins** — add exactly:
   - `https://anythingvn.github.io`
   - `http://localhost:5173`
3. Redirect URIs are not needed. Click **Create** and copy the **Client ID**
   (it ends in `.apps.googleusercontent.com`).

## 4. In the app
**Settings → Google Drive:** paste the Client ID, check the main folder name, **Save**, then **Connect Google Drive**
and allow access in Google's window.

## Important
- Only the **Client ID** goes into the app. It is public by design and only works on the origins above.
- A **"Desktop app"** client does not work for this web app.
- The downloaded `client_secret_….json` file contains a **client secret** that this app never uses.
  Keep it private and **never commit it** to the repository.
- The app can only see and change files it created itself. It never reads the rest of your Drive.
- Google access expires after about an hour; the app renews it quietly, or asks again with one click.

## Troubleshooting
| Message | Fix |
|---|---|
| Google shows "Error 400: origin_mismatch", or the app says "Could not connect … check that <address> is listed under Authorized JavaScript origins" | Add that address to the client's JavaScript origins (step 3), wait a few minutes, retry |
| "Not connected to Google Drive" | Click Retry or Connect again; if you're not a test user, add yourself (step 2) |
| "Offline" | Reconnect to the internet and click Retry |
