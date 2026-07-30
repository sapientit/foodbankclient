Referral maintenance.
Administrators can amend or cancel referrals or move them to another session (even if that exceeds capacity with a client generated warning). 

#Login
Authentication will eventually be via a Google id.  Initial version will be a dummy signon page with no validation, but this should still generate an expiring security token, with refresh tokens etc.

#Stock maintenance
There are about 40 stock items (with a maintenance facility to amend them).  After a shop, there will be a facility to type sug and it will find sugar and autocomplete.  Then a field for how many we bought.  This will add to the existing stock.
There will also be a list screen with items and current stock that can be maintained for a stock take.
Stock is maintained in a certain place in the warehouse. So each stock item has a "shelf number" .  The list should be by shelf number

#Picking list
Against a session there will be an option to view picking list.  If that picking list has not been created yet, then it will be done at this point.  For each referral, the number of adults and children will result via a series of rules into a model picking list. 
This picking list can be easily modified (add new items, change quantities).  This generates a printable picking list page per referral, with a referral number and the stock items they require and quantities.

After picking is complete, modifications can be made to the list.

#Model parcels and the household grid
The "series of rules" that turns a household into a model picking list is a lookup, not a calculation.

There is a table of model picking lists.  Each has a name as its key and its contents as JSON - the stock items and quantities that make up that parcel.

Separately there is a grid of every possible household size.  Adults run from 1 to 5 and children from 0 to 5, so there are 30 entries.  A household larger than 5 adults counts as 5, and more than 5 children counts as 5.  Each grid entry holds just the name of the model picking list to use for that household size, so several household sizes can share one model parcel and changing that parcel updates all of them.  The grid is maintained as a whole and updated in one go, so it can be stored as a single row.

A referral must have at least one adult, so every referral maps to a real grid entry.

The model picking lists are not versioned.  When a picking list is created for a session, the contents of the relevant model are copied onto each referral's parcel.  From then on that parcel holds its own contents and is unaffected by any later change to the model or the grid.  The parcel does not record which model it came from - only what is in it.

#Session maintenance
Administrators can create and amend either weekly or ad hoc sessions and update the package limit for each.

#Session processing
Having selected a session, there are options to view and update the picking lists. To confirm attendance (or delivery to) a client (or to confirm non attendance - one or the other must be done)
After the session, each referee is marked as attended or did not show.  If they attended, the stock is updated.  Otherwise the parcel will be unpacked.
Only when all clients have been confirmed as attended or no show (or delivered/not delivered) can the session be confirmed and closed

#Menus
If the id is an admin account then a full menu is shown.  If a team leader a partial menu is shown.
In the partial menu there are options for stock taking, adding shopping, and see all the planned sessions (and sessions for the past few days).
The full menu allows maintenance of security information, model packets, assignment of model packets to family size, stock item maintenance, and see full details of clients by session (and update details for a client.

#Valid referrers
A table of valid referrers is maintained.  These are either full email addresses or any email address for a given domain (*@organisation.com).  Only administrators can maintain these


#Referrals
The flow for referrals is that the referrer will put in their email address.  This is validated by the server, and if it passes they will then be asked for information about the client.  Some information is fixed - name, address, phone number etc, but some is subject to change.  The actual questions to be asked and the validation for them will be in a json config file as part of the client.  This is replacing a google form, so basic validation of drop downs, radio buttons, free form text, number validation etc.
This is then submitted to the server.
The session that the client will attend will be from a drop down of the available sessions (non full) for the net 2 weeks.

