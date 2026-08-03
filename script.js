document.addEventListener('DOMContentLoaded', function () {
    const today = new Date();
    const formattedDate = getFormattedDate(today);

    setTitle(formattedDate);

    const genreElement = document.getElementById('genre');
    const spotifyLinkElement = document.getElementById('spotify-link');
    const spotifyLinkTextElement = document.getElementById('spotify-link-text');
    const descriptionElement = document.getElementById('description');

    updateDescription('Loading description...');

    fetch('assets/data/filteredPulse.csv')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.text();
        })
        .then(text => {
            const lines = text.split('\n');
            const data = lines.slice(1).filter(line => line.trim() !== '');

            if (data.length === 0) {
                throw new Error('No genre data is available.');
            }

            const dayOfYear = Math.floor(
                (today - new Date(today.getFullYear(), 0, 0)) / 86400000
            );

            function seededRandom(seed) {
                const value = Math.sin(seed) * 10000;
                return value - Math.floor(value);
            }

            const randomIndex = Math.floor(seededRandom(dayOfYear) * data.length);
            const selectedLine = data[randomIndex].split(',');

            const name = selectedLine[0].trim();
            const spotifyLink = getBrowserSafeSpotifyLink(
                selectedLine[2] || selectedLine[1]
            );

            genreElement.textContent = name;
            spotifyLinkElement.href = spotifyLink;
            spotifyLinkTextElement.textContent = 'Listen on Spotify';
            spotifyLinkTextElement.href = spotifyLink;

            fetchWikipediaDescription(name);
        })
        .catch(error => {
            console.error('Error loading the genre:', error);
            updateDescription('This genre could not be loaded. Please try again later.');
        });

    function getBrowserSafeSpotifyLink(rawLink) {
        const link = (rawLink || '').trim();

        if (link.startsWith('spotify:user:')) {
            const playlistId = link.split(':').pop();
            return `https://open.spotify.com/playlist/${playlistId}`;
        }

        return link.replace(/^http:\/\//, 'https://');
    }

    function fetchWikipediaDescription(searchTerm) {
        fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(searchTerm)}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                updateDescription(
                    data.extract || 'No Wikipedia description is available for this genre yet.'
                );
            })
            .catch(error => {
                console.error('Error loading Wikipedia content:', error);
                updateDescription('Background information is not available right now.');
            });
    }

    function updateDescription(text) {
        descriptionElement.innerText = text;
    }

    function getFormattedDate(date) {
        return `${date.getMonth() + 1}/${date.getDate()}`;
    }

    function setTitle(date) {
        document.getElementById('title').textContent = `Genre of the Day (${date})`;
    }
});
