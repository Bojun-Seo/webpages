# Fair Group Vote

A page for a group that has to settle on one thing together, a date or a place for a team
dinner (회식), a menu, anything: its maker sets up a poll under a group ID and a PIN of their
choosing, the others get in with both, each grades every option under their own name, and the
page picks the option the group goes with by a rule from social choice theory, the part of
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
3. **Voting, by name.** A voter gives their name and grades every option: dates 좋아요 ○, 되긴 해요 △
   or 안 돼요 ✕; other options 최고, 좋아요, 보통, 별로 or 안 돼요. "안 돼요" says they cannot
   come or cannot have it at all. 안 고른 후보 모두 fills the rest with one grade. The browser keeps
   the key of each ballot cast from it, so the voter can change or take back their ballot until
   the poll closes; a second ballot under a name already taken is turned down. One phone can vote
   for several people with 다른 사람으로 새로 투표.
4. **Results**, live for everyone who is in: the options in the order of the rule below, each
   with how many gave each grade, who they were, its head-to-head record and why it is where it
   is; the circle, when majorities go round in one; for dates the same on a calendar; and what
   seven other well-known rules would pick from the same ballots.
5. **Closing.** The poll closes at its deadline, or when its maker closes it, and the decision
   shows at the top. The maker's menu also reopens the poll, takes out any ballot, and deletes
   the poll. It opens on the device that made the poll; another needs the admin code it shows.
6. **Sharing.** 함께할 사람 부르기 copies the link, or an invitation with the link, the group ID and,
   where the device knows it, the PIN, or hands it to the phone's share sheet.

## How the group's choice is made

Picking one option everyone shares is a question of social choice (Arrow, Sen) rather than of
matching (Gale, Shapley and Roth), which pairs people with different things. Arrow's theorem
says no rule satisfies every fairness property at once, so the page fixes its rule before anyone
votes, says it on the page, and shows beside the result what other rules would have picked.

A voter prefers one option to another when they grade it higher: 최고 over 좋아요 over 보통 over
별로 over 안 돼요, and for dates ○ over △ over ✕. `common/site/social-choice.js` places the options
one place at a time, first place first, each time among the options not yet placed:

1. **Fewest 안 돼요.** Only the options the fewest cannot make stay in the running. An option
   someone cannot make leaves them out, so the options everyone can share come first: the worst
   off first, after Rawls.
2. **The Condorcet winner.** Of those, the option that beats every other head to head, more voters
   grading it higher, is placed: what a majority prefers to anything else.
3. **The Condorcet paradox, settled by Borda.** Majorities can go round in a circle, as in
   rock-paper-scissors: A beats B, B beats C and C beats A, and no option beats every other. The
   rule then takes the options caught in the circle, the top cycle (Smith set), and of them the one
   with the most Borda points, a point from each voter for every other option in the running they
   grade lower and half a point for every one they grade the same. Borda adds every head-to-head
   contest up at once, so what goes round in the circle cancels out (Saari), and a Condorcet winner
   else Borda's is Black's method (1958). Options that draw head to head are settled the same way.
4. **Then the product of the grades.** Still level, the largest product of the scores of those who
   can come (최고 4, 좋아요 3, 보통 2, 별로 1; ○ 2, △ 1), the Nash social welfare (Nash 1950; Kaneko
   and Nakamura 1979), which falls sharply when anyone is unhappy; for dates, the most ○. Then the
   happier least happy voter (leximin).

Options level after all four share the place. When a poll closes with several first, it goes with
the one that comes first in an order the API drew at random when the poll was made. Nobody sees
the order, and since it was drawn once, closing again cannot draw again. In a perfectly even circle,
three voters each preferring a different option, that order decides.

The results show the circle when there is one, with the majorities that make it, each option's
head-to-head wins, draws and losses and its score against every other option, and why each place
went as it did. The tests check, on random ballots, that the rule is Pareto efficient, an option
that someone grades higher and nobody lower always ranking above, and Condorcet consistent, an
option that beats every other in the running always placed first. Beside the result the page shows
approval voting (the most 되긴 해요 or 보통 and above, the usual way of finding a date), the largest
sum (utilitarian), Borda alone, Nash's product, leximin alone (Rawls), majority judgment (the best
median, Balinski and Laraki 2007) and the Condorcet winner, or the circle when there is none.

The rule sides with a majority once nobody is left out. Where three love one restaurant and two
find it 별로 while everyone finds another 좋아요, it takes the first, though Nash's product would
take the second; a voter who cannot go somewhere says 안 돼요, which step 1 puts first.

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
check; a usual poll's is a few hundred.

### On the API

Once `FAIR_PICK_API` names the Worker in [`api/`](api/), [set up below](#set-up-the-api), the page
keeps its polls there instead. The link to a poll is then its address, `?g=<group ID>`, and anyone
with the group ID and PIN sees the same poll at once from any phone, with no links to pass on.

## Who can see and change what

In links:

- **Whoever has a link, the group ID and the PIN** sees the poll and every ballot and name in it,
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
- **Whoever has the group ID and the PIN** sees the poll, every ballot and every name on it, and
  can vote. The group ID must be one no other poll has. The API keeps the PIN as a salted SHA-256
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
the ballots cast from it, in its local storage under `fair-pick.polls`.

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

- Options cannot be changed once a poll is made, since ballots already cast grade the old ones;
  the maker makes the poll again.
- The PIN cannot be changed, and nobody can get it back from the API; the maker's device shows
  it. A lost admin code cannot be recovered either.
- Voting by name trusts the name: anyone with the PIN may vote under a name nobody has used yet,
  and the maker takes out a ballot that should not be there.
- The rule counts every voter the same. A dinner that cannot go ahead without someone is better
  settled by that person's 안 돼요, which the rule already puts first.
- Borda points, which settle a circle or a draw, can shift when options much alike are added, as a
  run of similar dates; a Condorcet winner, where there is one, does not.
- 안 돼요 is a veto, and a voter could cast it on every option but their favourite; the ballots are
  named, so everyone in the poll sees who did.
- Dates are whole days; a time of day goes in the note.
- On the API, the results refresh when the page comes back into view and with 새로고침, not by
  themselves.
