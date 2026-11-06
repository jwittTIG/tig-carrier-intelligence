# Setting up the carrier-updates mailbox (DECISIONS D20)

Who does this: a TIG Microsoft 365 admin (Exchange admin + Entra admin rights). Time: about 30 minutes.
Result: a shared mailbox staff can forward carrier emails to, which the app can read **and nothing else**.

You'll end up with four values. Three go to Claude; one (the secret) does not:

| Value | Where it goes |
|---|---|
| Mailbox address, e.g. `carrier-updates@tigknoxville.com` | Send to Claude |
| Directory (tenant) ID | Send to Claude |
| Application (client) ID | Send to Claude |
| Client secret | **Never send it in chat or email.** Put it in the password manager, and in `.env.local` / the hosting settings yourself |

---

## 1. Create the shared mailbox
1. Go to **Exchange admin center** (admin.exchange.microsoft.com) → **Recipients** → **Mailboxes** → **Add a shared mailbox**.
2. Display name: `Carrier Updates`. Email: `carrier-updates@tigknoxville.com`, or any name you prefer.
3. Optional: add staff as members if they should also open it in Outlook.

A shared mailbox under 50 GB needs no license.

## 2. Accept mail only from inside TIG
This keeps outside spam out and means everything in the mailbox was forwarded by staff (D20: staff-only senders).
1. In the mailbox's settings → **Mail flow settings** → **Message delivery restrictions** → **Edit**.
2. Under *Accept messages from*, tick **Require that all senders are authenticated**, or choose specific senders or groups (e.g. an "All staff" group).
3. Save.

Carriers can still email staff as usual. Staff then forward the email to this address.

## 3. Register the app in Microsoft Entra
1. Go to **Microsoft Entra admin center** (entra.microsoft.com) → **Applications** → **App registrations** → **New registration**.
2. Name: `TIG Carrier Intelligence - mail intake`. Supported account types: **Accounts in this organizational directory only**. No redirect URI. Register.
3. From the overview page, note the **Application (client) ID** and the **Directory (tenant) ID**.
4. Go to **Certificates & secrets** → **New client secret**. Description `mail intake`, expiry 12–24 months. Copy the secret **Value** straight into the password manager; it is shown only once. Put a reminder in the calendar to renew it before it expires.
5. Go to **Enterprise applications**, open the same app, and note its **Object ID**. This is the service principal's Object ID, which is different from the app registration's.
6. **Do not** add the Microsoft Graph "Mail.Read" *application* permission under API permissions. That permission covers every mailbox in the tenant. Step 4 grants access to this one mailbox instead.

## 4. Limit the app to this one mailbox (Exchange Online PowerShell)
This uses Exchange's "RBAC for Applications". Run it in PowerShell on an admin PC:

```powershell
Install-Module ExchangeOnlineManagement   # once, if not installed
Connect-ExchangeOnline

# Replace the three values in angle brackets.
New-ServicePrincipal -AppId <Application (client) ID> -ObjectId <Enterprise app Object ID> -DisplayName "TIG Carrier Intelligence mail intake"

New-ManagementScope -Name "Carrier Updates mailbox only" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'carrier-updates@tigknoxville.com'"

New-ManagementRoleAssignment -App <Application (client) ID> -Role "Application Mail.Read" -CustomResourceScope "Carrier Updates mailbox only"
```

Then check it. The first command should say the app **is** authorized for the shared mailbox; the second (your own mailbox) should say it is **not**:

```powershell
Test-ServicePrincipalAuthorization -Identity <Application (client) ID> -Resource carrier-updates@tigknoxville.com
Test-ServicePrincipalAuthorization -Identity <Application (client) ID> -Resource jwitt@tigknoxville.com
```

Read-only (`Mail.Read`) is enough: the app keeps its own record of which messages it has already taken in, and never moves, deletes or sends mail. Permission changes can take up to about an hour to apply.

## 5. Hand-off
1. Send Claude the mailbox address, the tenant ID and the client ID.
2. Add these lines to `C:\dev\tig-carrier-intelligence\.env.local` yourself (placeholders are in `.env.example`):
   ```
   MAIL_INTAKE_DRIVER="graph"
   MAIL_INTAKE_MAILBOX="carrier-updates@tigknoxville.com"
   MS_GRAPH_TENANT_ID="..."
   MS_GRAPH_CLIENT_ID="..."
   MS_GRAPH_CLIENT_SECRET="..."
   ```
3. Forward one test email with a PDF attachment to the mailbox, so the first real run has something to find.

## Notes
- **Until the mailbox exists**, the app uses a labeled dev adapter that reads `.eml` files from a local folder and refuses to run in production. Milestone 6 can be built and tested that way.
- **Turning it off:** remove the role assignment (`Remove-ManagementRoleAssignment`), or delete the client secret. The app then can't read anything.
- **Microsoft's references:** "Role Based Access Control for Applications in Exchange Online" and "Message delivery restrictions for mailboxes". If the Exchange admin center screens look different from these steps, the setting names above are what to look for.
