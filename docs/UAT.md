# Pilot user-acceptance checklist

For the TIG pilot, with fictional or sample data only until production is set up (docs/OPERATIONS.md). Tick each item and note problems. Run `npm.cmd run db:start` and `npm.cmd run dev`, then open http://localhost:3000.

## Getting in
- [ ] Sign in as DEMO Producer and as DEMO Admin. Only Admin sees **Users**.
- [ ] As Admin, invite a test person, deactivate them, and reactivate them.

## Carriers
- [ ] Create a carrier, add a NAIC number, link it to a group, then archive and restore it.
- [ ] Add a product and a direct channel, plus a wholesaler channel through an intermediary.
- [ ] Change history shows each change with who and when.

## Contacts
- [ ] Add an underwriter assigned to a carrier for Tennessee, with a GL specialty.
- [ ] "Confirm still current", then find them through Contacts → carrier + Tennessee.

## Appointments & codes
- [ ] Add an appointment and a producer code. Adding the same code twice shows a clear error.
- [ ] Set the appointment's end date to yesterday. It shows **Expired** and its codes aren't current.
- [ ] Add a portal link. Typing "Password: x" in its instructions is refused.

## Documents, appetite, approvals
- [ ] Upload an appetite guide PDF to a carrier, download it, and upload a second version.
- [ ] Draft appetite: a rule for TN + NAICS 238160 → Accepted; cite the guide page; submit.
- [ ] As the same person, approval is refused. As someone else, approve it.
- [ ] Market Finder: product + Tennessee + NAICS 238160 + $2,000,000. The carrier appears under **Accepted**, with its appointment status, limits and contacts.
- [ ] Start version 2, approve it, and see version 1 retired the day before.

## Commissions
- [ ] Add an agreement with the signed agreement document, submit, and have someone else approve.
- [ ] Add a new-business 15% schedule and approve it. Add 14% from next Jan 1 and approve it. The 15% schedule ends Dec 31.
- [ ] Download the schedules CSV and open it in Excel.

## Import
- [ ] Import a small carriers CSV with one duplicate and one bad row. Check the preview, commit, and download the error report.

## Overall
- [ ] Is anything confusing, slow, or missing for daily use? Note it here.
