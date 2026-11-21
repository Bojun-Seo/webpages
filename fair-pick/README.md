# Fair Group Vote

A page for a group that has to settle on one thing together, a date or a place for a team
dinner (회식), a menu, anything: its maker sets up a poll under a group ID and a PIN of their
choosing, the others get in with both and vote under their own names, each date ○, △ or ✕ and
every other option in order, and the page picks the option the group goes with by a rule from
social choice theory, the part of
economics that studies how a group should choose. Dates are picked on a Korean calendar, with
Sundays and public holidays in red and Saturdays in blue; the holidays are those in
[`common/site/holidays.json`](../common/README.md#update-the-holidays).

GitHub Pages serves the page, and it needs nothing else: each poll travels in its links, sealed
with the group ID and the PIN, and the votes add up as the links go round a group chat. A small API
of its own, a Cloudflare Worker with a Durable Object for each poll ([`api/`](api/)), can keep the
polls in one place instead once it is set up. What the page and the API both use, the voting rule,
what a poll may hold and the calendar, is in [`common/`](../common/).

The page is in Korean.

## Contents

- [What it does](#what-it-does)
- [How the group's choice is made](#how-the-groups-choice-is-made)
- [Where the polls live](#where-the-polls-live)
- [Who can see and change what](#who-can-see-and-change-what)
- [Set up the API](#set-up-the-api)
- [Publish on GitHub Pages](#publish-on-github-pages)
- [Run and test locally](#run-and-test-locally)
- [Known limitations](#known-limitations)

## What it does

The page has three views, one address each: home (`fair-pick/`), a new poll (`?new`) and a poll
(`?g=<group ID>`). What follows holds wherever the polls live; [where they
live](#where-the-polls-live) changes how a poll gets from one phone to another.

1. **Making a poll.** The maker picks what is decided, dates or options they write down (장소·메뉴
   등), gives it a title and, if they like, a note and a deadline in Korean time. Dates are picked
   on a month calendar that starts on Sunday, from this month to twelve ahead, a tap for each
   date; tapping a weekday's name picks every date on it still ahead in that month, or takes them
   all out again. Public holidays are named in the calendar and under it. Two to 31 dates, or two
   to 20 options. Then the maker chooses the group ID and a PIN of four to eight digits; 무작위
   makes one, and the guessable ones, one digit over and over or digits counting up or down
   (0000, 1234, 9876), are turned down.
2. **Getting in.** It takes the group ID and the PIN. The browser remembers a poll it has been in,
   so the page opens straight to it after that and lists it on the home page; 이 기기에서 이 투표 잊기
   forgets it.
3. **Voting, by name.** A voter gives their name and answers every date 좋아요 ○ (would like it),
   되긴 해요 △ (can come, would rather not) or 못 가요 ✕ (cannot come); 안 고른 날 모두 fills the
   rest with one answer, and the ballot shows the voter's mileage, below, as they go. Other options
   they put in order, tapping them best first; the one left goes last by itself, a tap on one in
   the order takes it out again, and 처음부터 다시 고르기 starts over. The browser keeps the key of
   each ballot cast from it and what it was cast with, so the voter can change or take back their
   ballot until the poll closes; a second ballot under a name already taken is turned down. One
   phone can vote for several people with 다른 사람으로 새로 투표.
4. **Results, once the poll closes.** Until then everyone sees who voted but not how, the maker
   too, so that nobody votes by what the others did. Then the options show in the order of the
   rule below, each with who answered what or put it where, and why it is where it is: for a date
   its score and each voter's mileage, and on a calendar; for an option its head-to-head record,
   its Borda points and the circle, when majorities go round in one. Beside them, what other
   well-known rules would pick from the same ballots.
5. **Closing.** The poll closes at its deadline, or when its maker closes it, and the decision
   shows at the top; for a date, with the names of those who said they cannot come that day. The
   maker's menu also reopens the poll, takes out any ballot, and deletes the poll. It opens on the
   device that made the poll; another needs the admin code it shows.
6. **Sharing.** 함께할 사람 부르기 copies the link, or an invitation with the link, the group ID and,
   where the device knows it, the PIN, or hands it to the phone's share sheet.

## How the group's choice is made

Picking one option everyone shares is a question of social choice (Arrow, Sen) rather than of
matching (Gale, Shapley and Roth), which pairs people with different things. Arrow's theorem
says no rule satisfies every fairness property at once, so the page fixes its rule before anyone
votes, says it on the page, and shows beside the result what other rules would have picked. A
date and a place are asked differently, since a date is first a question of who can come and a
place only of who likes what. `common/site/social-choice.js` places the options one place at a
time, first place first, each time among the options not yet placed.

### Dates: ○, △ or ✕, and mileage

1. **Fewest ✕.** Only the dates the fewest cannot come to stay in the running, every voter counting
   one: a dinner is first for everyone who can be there.
2. **The highest preference score.** Of those, the date whose ○ weigh the most: the sum of the
   mileage of the voters who gave it ○. Every voter starts with a mileage of 100%; each ✕ they give
   takes 1/n off it and each △ half that, n being the number of dates, and what is left weighs
   each of their ○. ✕ and △ ask the others to fit around the voter, so they cost what they ask: a
   voter who leaves many dates open says more with each ○, and a date they give △ loses more, than
   one who shuts many. Giving △ to every date but a favourite, to push it, mostly spends the
   mileage that would have pushed it.
3. **Absent, by name.** When the date picked is one someone gave ✕, the decision names them under
   it. A ✕ cast only to steer the date away is a claim made in front of the group: if that day is
   picked anyway, its maker is listed as absent, and everyone sees if they come after all.

Each date gets one score, so the order never goes round in a circle.

### Places and other options: an order

A voter puts every option in order. Each ballot hands out the same points, n - 1 for the first down
to 0 for the last, so no ballot weighs more than another and nobody can rule an option out alone.

1. **The Condorcet winner.** The option that beats every other head to head, more voters putting it
   above, is placed: what a majority prefers to anything else.
2. **The Condorcet paradox, settled by Borda.** Majorities can go round in a circle, as in
   rock-paper-scissors: A beats B, B beats C and C beats A, and no option beats every other. The
   rule then takes the options caught in the circle, the top cycle (Smith set), and of them the one
   with the most Borda points, a point from each voter for every other option still in the running
   they put below it. Borda adds every head-to-head contest up at once, so what goes round in the
   circle cancels out (Saari), and a Condorcet winner else Borda's is Black's method (1958). Options
   that draw head to head are settled the same way.

### Either way

Options still level share the place. When a poll closes with several first, it goes with the one
that comes first in an order drawn at random when the poll was made, by the API or, in links, by
the maker's phone. Nobody sees the order, and since it was drawn once, closing again cannot draw
again. In a perfectly even circle, three voters each preferring a different option, that order
decides.

Until the poll closes the page shows who voted but not how, the maker included: whoever could see
the others' ballots could work out the one false ✕ or the one option put last that tips the result.
The API sends no ballot's answers before the close. In links every ballot travels in the link all
along, so that any phone can close the poll, and a member set on it could unseal a link and look.

The tests check, on random ballots, that an option every voter puts above another always ranks
above it, that a Condorcet winner always comes first, and that a date answered better by one voter
and no worse by anyone ranks above. Beside the result the page shows, for dates, the rule without
mileage (every ○ one vote), the most ○ whoever cannot come, and the largest sum (utilitarian; ○ 2,
△ 1); for options, the most first places (plurality), Borda alone, the most head-to-head wins
(Copeland) and the best lowest place (Rawls's leximin).

## Where the polls live

### In links, with no server

Until the repository variable `FAIR_PICK_API` names an API, the page keeps its polls in links
(`site/link.js`), and that is how it is published now.

1. **Sealing.** A link carries the poll and every ballot the phone has seen, as JSON, compressed and
   encrypted with AES-GCM under a key drawn from the group ID and the PIN by PBKDF2-SHA256, 600,000
   rounds salted with the poll's own random ID. All of it goes after the link's `#`, which a browser
   never sends to the site, so neither GitHub nor anyone else in between sees it, and without both
   the group ID and the PIN the link reads as noise.
2. **Going round.** The maker posts the invitation, the link with the group ID and PIN, in the group
   chat. Whoever opens it enters the group ID and the PIN, votes, and is handed a new link that
   carries their vote as well, to post in the chat in turn, the way a list is passed on in a
   KakaoTalk 이어쓰기. Every change brings up a box asking for its link to go to the chat.
3. **Adding up.** Opening any of the links, or pasting them into 받은 링크 합치기, adds what they carry
   to what the phone keeps. Ballots merge by their own ID, the later change winning, and a ballot
   taken out stays out, so neither the order the links are opened in nor opening one twice changes
   anything; two people who voted from the same older link both count once someone opens both
   their links. The results say they count the ballots this phone has.
4. **Closing.** The maker's phone draws a seed when the poll is made and puts only its SHA-256 in the
   poll. Closing shows the seed in the closing link; every phone checks it against the hash, and a
   draw between options level at the top follows the order the seed gives, so the maker cannot draw
   again. A deadline closes the poll on every phone by itself; if options are level then, the
   decision waits for the maker's phone, which shows the seed the next time it opens the poll.

A link for thirty voters on a whole month of dates stays under 4,000 characters, which the tests
check; a usual poll's is a few hundred. A link from before places were put in order, which graded
them from 안 돼요 to 최고, opens with each ballot's grades turned into an order, places graded alike
in an order drawn from the ballot's ID, the same on every phone; its dates keep their ○, △ and ✕.

### On the API

Once `FAIR_PICK_API` names the Worker in [`api/`](api/), [set up below](#set-up-the-api), the page
keeps its polls there instead. The link to a poll is then its address, `?g=<group ID>`, and anyone
with the group ID and PIN sees the same poll at once from any phone, with no links to pass on.

## Who can see and change what

In links:

- **Whoever has a link, the group ID and the PIN** sees the poll and who voted, how once it closes,
  and can vote. With no server, nothing limits how often a PIN is guessed: each guess takes a
  PBKDF2 derivation, under a second on a phone but far less on a graphics card, where an
  eight-digit PIN falls in hours to whoever has both the link and the group ID. So the links stay
  in the group chat, the group ID is best hard to guess, and the page recommends eight digits.
- **A voter** changes or takes back their own ballots from the phone that cast them, and **the
  maker** closes, reopens and takes out any ballot with the admin code, which is the seed.
- **Nothing stops a member who has the group ID and the PIN** from writing a link of their own with
  the ballots changed, since no server checks a change. The ballots are named and a change shows
  under its voter's name, so the page suits people who trust each other; the API gives the stronger
  guarantee.
- **No server stores anything.** Each phone keeps the polls it has opened in its local storage,
  under `fair-pick.links`, until 이 기기에서 이 투표 잊기 forgets one there.

On the API:

- **Anyone** can open the page and make a poll; an address may try to make twenty an hour.
- **Whoever has the group ID and the PIN** sees the poll and every name on it, every ballot once
  it closes, and can vote. The group ID must be one no other poll has. The API keeps the PIN as a salted SHA-256
  hash, so it can check a PIN but not give it back. An address that gets a poll's PIN wrong five times waits ten minutes, and a poll that
  sees fifty wrong PINs within an hour, from anywhere, takes none until the hour is out; the right
  PIN then waits too, since otherwise the guessing would go on. A wrong PIN and a group ID that
  does not exist get the same answer. Four digits are guessed in days at that rate, six in about
  a year, so the page asks for six.
- **A voter** changes or takes back only their own ballots: the API gives a key with each
  ballot, which their browser keeps, and keeps only its hash.
- **The maker** closes, reopens and deletes the poll and takes out any ballot, with the admin
  code the API gave when the poll was made, also kept as a hash.
- **Nobody** can see the order a draw would take. A poll is deleted 60 days after it last
  changed, and at once when its maker deletes it.

The page talks to the API with `fetch`; the API answers browsers on the page's own site and on
this machine only (`ALLOWED_ORIGINS` in `api/wrangler.toml`).

Either way, the browser keeps for each poll it has been in the PIN, any admin code and the keys of
the ballots cast from it with what they were cast with, in its local storage under
`fair-pick.polls`.

## Set up the API

The API is optional: the page works without it, in links. The Worker runs on Cloudflare's free
plan, which takes Durable Objects that keep their data in
SQLite: a poll is one object, named by its group ID, so its changes happen one at a time in one
place. [`fair-pick-api.yml`](../.github/workflows/fair-pick-api.yml) deploys it. Once:

1. Make a Cloudflare account and choose its `workers.dev` subdomain (**Workers & Pages**, the
   first time it is opened).
2. Make an API token from the **Edit Cloudflare Workers** template (**My Profile → API Tokens**),
   and find the account ID (**Workers & Pages**, on the right).
3. In this repository, add the secrets **`CLOUDFLARE_API_TOKEN`** and **`CLOUDFLARE_ACCOUNT_ID`**
   (**Settings → Secrets and variables → Actions**).
4. Run **Actions → fair-pick api → Run workflow** on the default branch. Its summary gives the
   Worker's address, `https://fair-pick.<subdomain>.workers.dev`.
5. Add that address as the repository **variable** `FAIR_PICK_API` (the **Variables** tab), then
   run **Actions → pages → Run workflow**.

After that, a push to the default branch that changes `api/` or `common/site/` deploys the Worker
again; a push to another branch runs the tests and bundles it without
deploying. Until the secrets are set the workflow warns and deploys nothing, and until
`FAIR_PICK_API` is set the page keeps its polls in links.

The Worker's name, `fair-pick`, and the sites allowed to call it are in `api/wrangler.toml`; a
fork serves its page from another site, so it changes `ALLOWED_ORIGINS`. The free plan allows
100,000 Worker requests and 100,000 Durable Object requests a day; each call the page makes is one
of each, and making a poll one more of the second.

## Publish on GitHub Pages

[`pages.yml`](../.github/workflows/pages.yml) runs the tests and opens the page in a browser on
every push that touches `fair-pick/` or `common/`: once as published without an API, two phones
passing a poll in links, and once with the API answered by its Worker on memory. On the default
branch it publishes `site/` to <https://bojun-seo.github.io/webpages/fair-pick/>, writing
`FAIR_PICK_API`, if it is set, into `config.js`. The [top-level README](../README.md#publishing) says how the
site is put together.

## Run and test locally

To try the page as it is published, polls in links:

```
cd fair-pick
npm run serve        # http://localhost:8000/fair-pick/
npm run serve:api    # the same, with an API on memory that forgets the polls when it stops
```

To run the Worker in workerd, Cloudflare's runtime, instead: `cd api && npm ci && npm run dev`
(port 8787), and point `site/config.js` at it.

Tests need Node 20 or later and nothing else. They pass polls between phones simulated in memory,
and run the Worker against Durable Objects kept in memory (`api/memory.js`):

```
npm test
```

## Known limitations

- In links, each phone counts the ballots it has received. Until everyone's links have been opened
  the results differ from phone to phone, so the maker opens every link in the chat before closing.
- In links, taking a poll away takes it off one phone only; the links in the chat still open it.

- Options cannot be changed once a poll is made, since ballots already cast answer the old ones;
  the maker makes the poll again.
- The PIN cannot be changed, and nobody can get it back from the API; the maker's device shows
  it. A lost admin code cannot be recovered either.
- Voting by name trusts the name: anyone with the PIN may vote under a name nobody has used yet,
  and the maker takes out a ballot that should not be there.
- Who can come counts everyone the same. A dinner that cannot go ahead without one person is
  better given only the dates that person can make.
- Mileage cannot tell a voter who has few free days from one who only says so; both say less with
  each ○. A false ✕ still counts against a date as a true one does, and is checked only by the
  name under the decision and by the results staying hidden until the close.
- A voter can put the strongest rival of their favourite place last to bury it; with the results
  hidden until the close they cannot tell which one that is.
- Borda points, which settle a circle or a draw between places, can shift when options much alike
  are added; a Condorcet winner, where there is one, does not.
- A poll in links that closed before places were put in order and dates weighed by mileage is
  counted again by the rule now when it is opened, and may come out differently.
- Dates are whole days; a time of day goes in the note.
- On the API, the results refresh when the page comes back into view and with 새로고침, not by
  themselves.
