# Orfeu

Orfeu is a daily music-discovery experience for listeners who want to explore beyond familiar recommendations.

**Live site:** [jerryshi042003.github.io/orfeu](https://jerryshi042003.github.io/orfeu/)

![Orfeu location discovery demo](./assets/demo/indonesia.gif)

## What it does

Each day, Orfeu presents:

- a genre selected from a catalog of more than 6,000 genres;
- a browser-safe Spotify playlist link;
- background context from Wikipedia; and
- a location view for exploring music geographically.

The site is a public beta. It runs in the browser, requires no account, and works on desktop and mobile.

## How it was built

The source dataset was collected from Every Noise at Once with Python, BeautifulSoup, and Scrapy. The pipeline cleaned and classified genre records into three playlist perspectives:

- **The Sound** — a broad introduction to the genre.
- **The Pulse** — music popular with the genre's core listeners.
- **The Edge** — more experimental examples.

spaCy was used to extract geographic references for the location experience. The product is delivered as a lightweight static site using JavaScript, CSS, and D3.

## Product direction

The next useful improvements are:

1. add feedback and basic usage analytics;
2. let listeners save and share discoveries;
3. automate and monitor data refreshes; and
4. improve genre context when Wikipedia has no matching article.

## Name

Orfeu takes its name from the Brazilian Portuguese form of Orpheus, the musician and poet of Greek mythology.
