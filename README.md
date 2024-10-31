# Orfeu
*Named after the Brasilian pronouniciation of Orfeus, the Greek God of music.*     

While Spotify's recommendation algorithm is powerful, it focuses on music similarity, often feeding you a playlist regurgitation of genres you already know. It doesn't take risks and it focuses on marketing music instead of educating about music. Orfeu aims to break this cycle by introducing listeners to a broader scope of genres along with their historical and cultural importance. 

![Demo](./assets/demo/orfeu_demo2.gif)

<a href="https://youtube.com/shorts/lQzao0TsUYA?feature=share">
        <img src="assets/demo/IndonesiaCover.png" alt="Indonesia example" width="180" height="320" style="margin-right: 15px;">
    </a>
    
    <!-- Description -->
    <div>
        <p><strong>Indonesia's Music Highlight:</strong> This example from Orfeu showcases Indonesia's rich musical heritage. Indonesia has made substantial contributions to Southeast Asian music, blending traditional and modern styles. Key tracks include "Berharap Tak Berpisah" by Reza Artamevia, known for its soulful melody and heartfelt lyrics, "Tanya Hati" by Pasto, which captures the essence of Indonesian pop ballads, and "Pulang" by Float, an evocative song that resonates with listeners through its emotional depth and connection to home. These songs illustrate Indonesia's unique musical style and emotional expression.</p>
    </div>


## Methodology

The data was collected by scraping **everynoise.com** using web-scraping libraries **BeautifulSoup** and **Scrapy**. This data includes an extensive list of (>6000) genres, compared to the 126 that Spotify API provides, classified using ML into three distinct playlist types.  

- **The Sound**: A collection representing the general sound of the genre.
- **The Pulse**: Core songs beloved by the main listener demographic.
- **The Edge**: Tracks that represent the more experimental aspects of the genre.

A natural language processing model **SpaCy** was used to identify locations and separate playlists into geographic regions. This can be explored on subpage /locations

## How to Use

Visit the Orfeu website to discover a new genre each day. The site features:

- A randomly selected genre.
- A link to a Spotify playlist curated to explore the genre.
- Key descriptive points about the genre, web scraped from Wikipedia.

*I encourage users to listen to a few songs from different artists within the genre and perform a simple Google search to learn more about its cultural context.*

## Future Work
plan to add features:

- Lists of the most popular artists and songs within each genre.
- Insights into the genre’s influence on others.
- Detailed explanations of the rhythms, instruments, and cultural ties that define the genre.

## Tools

- **Web Scraping**: BeautifulSoup, Scrapy
- **Data Cleaning**: Python (pandas, numpy)
- **Visualizations**: D3.js
- **Music Data**: Spotify API, LastFM API, MusixMatch API
- **Geographical Data**: Google Maps API
