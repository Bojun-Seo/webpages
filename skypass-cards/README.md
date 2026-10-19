# SKYPASS Card Calculator

A static page that works out, for what the visitor spends in a month and on travel in a year, how
many Korean Air SKYPASS miles each of eight Korean credit cards earns in a year, what is left once
the miles are valued and the annual fee taken off, and what the fee comes to for each mile. GitHub
Pages serves it; there is no server.

The page is in Korean. It is not affiliated with Korean Air or any card issuer.

## Contents

- [What it does](#what-it-does)
- [Ground rules for a public page](#ground-rules-for-a-public-page)
- [Publish on GitHub Pages](#publish-on-github-pages)
- [Update the data](#update-the-data)
- [Run and test locally](#run-and-test-locally)
- [Known limitations](#known-limitations)

## What it does

The visitor enters, in 만원:

- each month: what they pay in Korea, the part of it at department stores, gas stations, coffee
  shops, convenience stores and taxis, which Samsung's card earns more on, and what they pay to
  overseas online shops;
- each year: what they pay abroad on trips, at duty-free shops and for tickets bought from Korean
  Air itself, and how many trips that is;
- what a mile is worth to them, 15 won unless they say otherwise, an annual fee limit and the order.

These are what the guides and community threads on choosing a mileage card come back to: most
cards earn about the same base miles, a mile for each 1,000 or 1,500 won, and differ in the extra
miles they give, where they give them, the monthly cap on them and the spend the previous month has
to reach (전월실적) ([KB Think](https://kbthink.com/main/living-finance/consumption-life/card-consumption/mileage-card.html)),
and whether the miles a year are worth more than the fee. Bills, taxes, gift cards and interest-free
instalments earn nothing on most cards, so the form asks the visitor to leave them out. The browser
keeps what the visitor entered in its local storage.

`site/calc.js` then works the year out month by month (`yearOf`, `cardYear`):

1. Every month spends the monthly amounts. Each trip has a month of its own, spread evenly across
   the year from the first, with an equal share of the spending abroad and at duty-free shops, and
   its Korean Air tickets, an equal share of theirs, are bought the month before.
2. A card's base rule earns on everything spent; its extra rules earn on what their kinds of
   spending take. Each earns only in a month whose previous month came to the spend it asks for
   (`minPrev`), counted from everything the visitor entered.
3. The extra miles of the rules that share a cap stop at it, monthly or yearly. A cap that the card's
   terms give on all the miles a kind of spending earns, base ones included (`counts: "total"`),
   leaves the extra miles their share of it: Hyundai's 4,000 miles a month at two miles a 1,000 won
   abroad is 2,000 extra miles on top of the base one.
4. A card with options, Samsung's 해외형 and 국내형, earns under the one that earns more over the
   year; one that only a card working abroad has (`overseasOnly`) counts only when the visitor pays
   abroad.
5. The annual bonus comes with a year that spends what the card asks from its second year on
   (`minYearSpend`); the first year usually asks less.
6. The fee is the one for a card that works abroad (해외겸용) when the visitor pays abroad at all,
   the one for a card for Korea alone otherwise.

The cards are listed in the order picked: most left when the miles are valued and the fee taken off,
most miles, or least fee for each mile. Each row opens on how the miles add up, the card's
conditions, the benefits left out of the sum, what could not be confirmed and where the terms come
from.

## Ground rules for a public page

The page is public, so it keeps to what an individual may publish about credit cards without
selling them. None of this is legal advice; it is how the page avoids the activities the laws below
regulate.

- **No compensation, no links to apply.** Only registered solicitors and the issuers' partners may
  solicit card members, and an issuer may not pay anyone else for it
  ([여신전문금융업법](https://www.easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=585&ccfNo=2&cciNo=2&cnpClsNo=1)).
  Under the Financial Consumer Protection Act, anyone but a registered seller is barred from
  advertising financial products (제22조), and the regulators look at whether a page is designed to
  promote sales, takes part in them or is paid
  ([금융위원회 법령해석](https://better.fsc.go.kr/fsc_new/replyCase/LawreqDetail.do?stNo=11&muNo=171&muGpNo=75&lawreqIdx=3933)).
  So the page takes no affiliate, referral or advertising money, carries no 신청 links or buttons,
  and links to no card issuer at all; the sources each card names are text, with their addresses
  kept in `cards.json` for whoever updates it.
- **Order by numbers only.** Every card in `cards.json` is shown, ranked by the visitor's own
  numbers; the page says nothing like 추천 or best, and the footer says it is not advertising,
  solicitation or brokerage.
- **Facts, not someone else's work.** The terms are facts gathered card by card from the issuers'
  pages and public write-ups, put in the page's own words and structure; nothing is copied from a
  comparison site's database or from anyone's spreadsheet, and no logo or card image is used.
- **No personal data.** The page computes in the browser, loads nothing from any other site, has no
  analytics, and keeps what the visitor enters in that browser's local storage alone.

## Publish on GitHub Pages

[`pages.yml`](../.github/workflows/pages.yml) runs the tests on every push that touches
`skypass-cards/`, and on the default branch publishes `site/` to
<https://bojun-seo.github.io/webpages/skypass-cards/>. The [top-level README](../README.md#publishing)
says how the site is put together. The page needs no secret.

## Update the data

Everything the page knows about the cards is in `site/data/cards.json`. Move `updated` on with each
change, and `checked` on each card whose terms were checked again. A card has:

- `id`, `issuer` and `name`;
- `fee`: the annual fee of the kind for Korea alone (`domestic`) and of the kind that works abroad
  (`overseas`), in won; a card that comes in one kind only gives that one;
- `base`: the miles (`miles`) for each `per` won on everything spent, and the previous month's spend
  it asks for (`minPrev`), none if left out;
- `extra`: the extra rules, each with the kinds of spending it covers (`on`: `domestic`, `daily`,
  `overseas`, `dutyFree`, `koreanAir`; `daily` is part of `domestic`, so no rule names both), its
  `miles` for each `per` won on top of the base ones, its `minPrev` and the cap it counts against
  (`cap`);
- `options`: for a card whose holder picks where the extra miles go, each option's `name`, its
  `extra` rules and whether only a card that works abroad has it (`overseasOnly`);
- `caps`: each cap's `miles` and whether they are a month's or a year's (`per`), with `"counts":
  "total"` for a cap the terms give on all the miles of its one rule's spending, base ones included;
- `annualBonus`: the bonus `miles` and the year's spend that earns them from the second year on
  (`minYearSpend`);
- `notes`, `perks` (benefits left out of the sum) and `unverified` (what the terms could not
  confirm, and what the page assumed instead), as the page shows them;
- `sources`: where the terms come from, each a `title` the page shows and the `url` it does not.

The terms of 19 October 2026 were gathered through web search, which quoted the issuers' pages and
guidebooks and the comparison sites named under `sources`; the issuers' sites themselves could not
be opened from where the data was put together. Check each card against its issuer's page before
publishing.

The tests check that every card has the fields the page reads and that its rules name only caps it
has and kinds of spending the page asks about, so run them after editing.

## Run and test locally

The page loads its data with `fetch`, which browsers refuse for `file://` pages, so serve the
directory:

```
cd skypass-cards
npm run serve        # http://localhost:8000
```

Tests need Node 20 or later and nothing else:

```
npm test
```

## Known limitations

- The cards are those that earn SKYPASS miles directly and whose terms could be found: Samsung's &
  MILEAGE PLATINUM, Shinhan's Air One, Woori's EVERY MILE SKYPASS, Hyundai's 대한항공카드 060, 120 and
  300 (Edition2, out since July 2024), KB's 마일리지 가온카드 and Hana's 스카이패스 아멕스 플래티늄. Left
  out are Citi's cards, no longer issued; Shinhan's The BEST-F and Hyundai's the First Edition2,
  whose earning terms could not be confirmed; cards that earn points to convert into miles; debit
  cards; and Asiana cards, whose miles merge into SKYPASS.
- Each card's `unverified` says what was assumed: KB's monthly cap and previous-month spend, Hana's
  cap and whether it is still issued, the cap on Shinhan's extra miles, which sources give
  differently, and Woori's fee for the kind for Korea alone.
- The year is a model, not a statement: every month spends the same, trips are spread evenly, and the
  previous month's spend is everything the visitor entered, though each issuer counts it its own
  way. Issuers that earn by the payment drop what falls short of 1,000 or 1,500 won on each one, so
  real miles can be a little fewer.
- Samsung's holder can switch between 해외형 and 국내형 each month; the page assumes one all year.
- Shinhan's extra mile at the Shilla duty-free shop online, Hyundai 300's extra miles at hotels,
  department stores and golf courses, and every non-mile benefit (lounges, coupons, fee waivers) are
  left out of the sum; the row lists the benefits it knows of.
- The annual bonus counts from the second year on; first-year sign-up events are left out.
