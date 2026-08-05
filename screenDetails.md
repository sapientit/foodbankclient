Referral maintenance.
Administrators can amend or cancel referrals or move them to another session (even if that exceeds capacity with a client generated warning). They also accept or reject the referrals that are waiting for a decision.

#Login
Authentication will eventually be via a Google id. Initial version will be a dummy signon page with no validation, but this should still generate an expiring security token, with refresh tokens etc.

#Stock maintenance
There are about 40 stock items (with a maintenance facility to amend them). After a shop, there will be a facility to type sug and it will find sugar and autocomplete. Then a field for how many we bought. This will add to the existing stock.
There will also be a list screen with items and current stock that can be maintained for a stock take.
Stock is maintained in a certain place in the warehouse. So each stock item has a shelf number. The list should be by shelf number. Stock-item maintenance has only two fields: name and shelf number. Units and low-stock thresholds are not maintained.

#Picking list
Against a session there will be an option to view picking list. If that picking list has not been created yet, then it will be done at this point. For each referral, the number of adults and children will result via a series of rules into a model picking list.
This picking list can be easily modified (add new items, change quantities). This generates a printable picking list page per referral, with a referral number and the stock items they require and quantities.

After picking is complete, modifications can be made to the list.

When a picking list is selected, it must show the referral's answers to the preference questions - the ones on the referral form that are about what the household wants or can eat, such as whether they need flour and whether it should be plain or self raising. These are what guide the person maintaining the list: the model parcel gives the starting point, and the preferences are how it gets adjusted for that household. Without them on the screen the list can only be maintained by guesswork.

This is a screen requirement, not a printing one. What appears on a printed sheet is decided separately, and the reason for referral never appears on either.

#The printed picking sheet
One sheet per parcel, and the whole picking list is printed in one go rather than a sheet at a time.

The pick number goes on the sheet large. It is what matches a sheet to a bag in a hall, and a picker reads it across a table. The referral's own number goes on it too, so a sheet can be traced back to the referral behind it.

The stock items and their quantities are listed in the order the server gives them, which is shelf order, so a picker walks the aisle once. That order is never rearranged on the way to the paper - not alphabetically, not by quantity, not by anything else.

The reason for referral never appears on a printed sheet. Not for an administrator either. Sheets are carried round halls and left on tables.

The referee's name goes on every sheet, so that a volunteer handing a bag over can tell it is the right one. Nothing else about them does unless the parcel is a delivery: then the sheet says DELIVERY, and carries the address, the postcode and the phone number, because the address is the point of that sheet and a driver who cannot find the door needs to ring.

Anything the picker needs in order to make up that particular parcel - the household's dietary notes among them - goes on the sheet prominently, because the picker is the only person in a position to act on it. Those notes are the household's answer to the dietary question on the referral form.

#Model parcels and the household grid
The "series of rules" that turns a household into a model picking list is a lookup, not a calculation.

There is a table of model picking lists. Each has a name as its key and its contents as JSON - the stock items and quantities that make up that parcel.

Separately there is a grid of every possible household size. Adults run from 1 to 5 and children from 0 to 5, so there are 30 entries. A household larger than 5 adults counts as 5, and more than 5 children counts as 5. Each grid entry holds just the name of the model picking list to use for that household size, so several household sizes can share one model parcel and changing that parcel updates all of them. The grid is maintained as a whole and updated in one go, so it can be stored as a single row.

A referral must have at least one adult, so every referral maps to a real grid entry.

The model picking lists are not versioned. When a picking list is created for a session, the contents of the relevant model are copied onto each referral's parcel. From then on that parcel holds its own contents and is unaffected by any later change to the model or the grid. The parcel does not record which model it came from - only what is in it.

#Session maintenance
Administrators can create and amend either weekly or ad hoc sessions and update the package limit for each.

#Session processing
Having selected a session, there are options to view and update the picking lists. To confirm attendance (or delivery to) a client (or to confirm non attendance - one or the other must be done)
After the session, each referee is marked as attended or did not show. If they attended, the stock is updated. Otherwise the parcel will be unpacked.
Only when all clients have been confirmed as attended or no show (or delivered/not delivered) can the session be confirmed and closed

#Menus
If the id is an admin account then a full menu is shown. If a team leader a partial menu is shown.
In the partial menu there are options for stock taking, adding shopping, and see all the planned sessions (and sessions for the past few days).
The full menu allows maintenance of security information, model packets, assignment of model packets to family size, stock item maintenance, and see full details of clients by session (and update details for a client.

#Valid referrers
A table of valid referrers is maintained. These are either full email addresses or any email address for a given domain (*@organisation.com). Only administrators can maintain these

#Referrals
The flow for referrals is that the referrer will put in their email address. This is checked against the charity's list, and either way they are then asked for information about the client. Some information is fixed - the referrer's own name and organisation, the client's first name, surname, date of birth, address, postcode and phone number, the session, how many adults and children, the main cause of crisis, whether a delivery is needed and whether they need help with fuel - but some is subject to change. The actual questions to be asked and the validation for them will be in a json config file as part of the client. This is replacing a google form, so basic validation of drop downs, radio buttons, free form text, number validation etc.
This is then submitted to the server.
The session that the client will attend will be from a drop down of the available sessions (non full) for the net 2 weeks.

The questions come from the charity's live google form, which has now been reviewed and supplied. The fixed fields above are settled and so are the additional questions; what remains open is the wording of some option lists, and those are listed as open questions rather than guessed at on screen.

Two kinds of question live in that configuration and it is worth keeping them apart. Questions about the person are what the referral is; preference questions - do they need flour, plain or self raising or none - are what the picking list is adjusted from. It is the second kind the picking list screen has to show.

The form is asked a page at a time, with a title on each page, because it is long and a referrer fills it in on a phone. Moving on is refused while something mandatory on the page in front of them is missing, and nothing on a later page is complained about before they have got there. How far through they are is always on the screen.

Where a question allows no answer at all, the screen offers "None" as a choice of its own and starts there unless the form says otherwise. None means none: choosing it clears everything else, choosing anything else clears it, and it is not recorded as an answer. Where a question allows several answers, the screen says how many may be chosen and stops accepting more once that many are.

A question that only applies because of an earlier answer is greyed out until that answer is given, and anything already typed into it is forgotten when it greys out again. The referral must never carry an answer to a question that is not on the screen.

The client's postcode is stored in capitals with a single space, however it was typed, because it is searched on and one household spelled three ways matches nothing.

The referrer's email address is checked as they type it, not after they have filled the form in. Somebody the charity does not recognise is told so before they have typed a household's details, not after - but they are not turned away. Their referral is taken and held for an administrator to accept or reject, and the screen says that is what will happen. When the address is recognised, the organisation it belongs to is already known and the form fills that in for them rather than asking - into an empty box only, never over an organisation the referrer has chosen for themselves. When it is not, the form asks which organisation they are from, offering the ones the charity already knows and letting them type one that is not there.

Recognising somebody is said as soon as it is known, but not recognising somebody is only said once they have finished with the address and moved on. Half of a real address looks like a whole one - pete@guildford.gov on the way to pete@guildford.gov.uk - and the charity does not tell a referrer it has never heard of them over an address they are still typing. Editing the address again takes the statement back until they have finished with it once more.

A household larger than the grid allows is not an error and is not shown as one. Anything over five adults or five children counts as five, so a household of nine receives the same parcel as five. If the screen says anything about it at all, it says it as information.

#After a referral is submitted
The referrer cannot change or withdraw a referral once it is submitted. There is no self-service route at all, and there is no window in which there is one.

Instead the screen confirms what was sent, showing back every answer that had to be given, because that is the referrer's only chance to notice that a surname or a session date is wrong. A referral that is waiting to be accepted says so plainly, so that nobody leaves believing a household is booked in when it is not.

To change anything after that the referrer telephones the food bank and an administrator makes the change. The screen says so plainly. This is a normal ending, not a fault, and it is not apologised for.

#Referrals awaiting review
A referral from an email address the charity does not recognise is held until an administrator accepts or rejects it. Until then it is not a booking: nothing is picked for it and it does not appear on a picking list.

The referral list shows the ones waiting first, because a household waiting on a decision is more urgent than one already booked in.

Accepting or rejecting one takes a single line of comment - why it was let through, or why it was not. There is one comment on a referral and a later review replaces it. It is not timestamped; the referral already records when it was submitted, and that is the date anybody asks about. Only administrators see it, because it can name a referrer or record a suspicion.

#Session processing screens
A session cannot be closed while anybody on it is still unmarked. When the screen refuses to close a session it names the pick numbers still waiting, because what the team leader needs to know is who is missing.

Marking a referee attended or a delivery delivered cannot be undone, so the screen confirms before sending it. Putting a mis-tap right is a stock correction by hand, which stays on the record.
