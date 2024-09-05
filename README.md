# Orfeu

## Project Overview

Orfeu is a project born from my passion for music and a desire to explore new sounds and the cultures they represent. While Spotify's recommendation algorithm is powerful, it tends to focus on music similar to what I’ve already listened to, limiting my exposure to truly diverse musical experiences. Orfeu aims to break this cycle by introducing listeners to a broader array of genres and the cultural contexts they stem from.

## Inspiration

The idea for Orfeu came from my love for discovering new music. Initially, I expanded my musical horizons by asking friends and acquaintances about the music they enjoyed. However, this approach had its limitations, prompting me to create a solution that could scale beyond my personal network.

## Prototype Development

To build Orfeu, I started by scraping **everynoise.com** using web scraping libraries such as **BeautifulSoup** and **Scrapy**. This allowed me to compile an extensive list of genres far beyond what the Spotify API provides. From this data, I generated three distinct playlists for each genre:

- **The Sound**: A collection representing the general sound of the genre.
- **The Pulse**: Core songs beloved by the main listener demographic.
- **The Edge**: Tracks that represent the more experimental or fringe aspects of the genre.

I also categorized and highlighted regional sounds to showcase the diversity within genres.

### Data Processing

The data collected from scraping required significant cleaning and organization, which I handled using Python. I structured the genre information, linked it with corresponding playlists, and ensured each genre was accurately represented.

## How to Use

Visit the Orfeu website to discover a new genre each day. The site features:

- A randomly selected genre.
- A link to a Spotify playlist curated to explore the genre.
- Key descriptive points about the genre, web scraped from Wikipedia.

I encourage users to listen to a few songs from different artists within the genre and perform a simple Google search to learn more about its cultural context. In future iterations, I plan to include additional features, such as:

- Lists of the most popular artists and songs within each genre.
- Insights into the genre’s influence on others.
- Detailed explanations of the rhythms, instruments, and cultural ties that define the genre.

## Tools and Technologies

- **Web Scraping**: BeautifulSoup, Scrapy
- **Data Cleaning**: Python (pandas, numpy)
- **Visualizations**: D3.js
- **Music Data**: Spotify API
- **Geographical Data**: Google Maps API

Orfeu is an ongoing project, with continuous improvements aimed at deepening the user’s understanding and appreciation of the world’s rich musical diversity.
