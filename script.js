document.addEventListener('DOMContentLoaded', function() {
    // Get the current date once and reuse it
    const today = new Date();
    const formattedDate = getFormattedDate(today);

    // Set the title when the page loads
    setTitle(formattedDate);

    const genreElement = document.getElementById('genre');
    const spotifyLinkElement = document.getElementById('spotify-link');
    const spotifyLinkTextElement = document.getElementById('spotify-link-text');
    const descriptionElement = document.getElementById('description'); // Element for description

    // Set static text for testing initially
    descriptionElement.innerText = 'Loading description...'; // Indicate loading state

    // Function to update description element
    function updateDescription(text) {
        descriptionElement.innerText = text;
    }

    // Fetch the CSV file
    fetch('assets/data/filteredPulse.csv')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.text();
        })
        .then(text => {
            // Parse CSV data
            const lines = text.split('\n');
            const data = lines.slice(1).filter(line => line.trim() !== ''); // Skip header and empty lines

            // Get the day of the year using the current date
            const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);

            // Select row based on the day of the year
            const index = dayOfYear % data.length;
            const selectedLine = data[index].split(',');

            const name = selectedLine[0].trim(); // First column as name
            const spotifyLink = selectedLine[2].trim(); // Third column as Spotify link

            // Display the name
            genreElement.textContent = name;

            // Use the Spotify link from the CSV
            spotifyLinkElement.href = spotifyLink;
            spotifyLinkTextElement.textContent = spotifyLink;
            spotifyLinkTextElement.href = spotifyLink;

            // Fetch Wikipedia description
            fetchWikipediaDescription(name);

        })
        .catch(error => {
            console.error('Error fetching the CSV file:', error);
            // Update description to indicate error
            updateDescription('Failed to load description 1.');
        });

    // Function to fetch Wikipedia description
    function fetchWikipediaDescription(searchTerm) {
        fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(searchTerm)}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.extract) {
                    updateDescription(data.extract);
                } else {
                    updateDescription('No description found.');
                }
            })
            .catch(error => {
                console.error('Error fetching Wikipedia content:', error);
                updateDescription('Failed to load description 2.');
            });
    }

    // Function to get the current date and format it as mm/dd
    function getFormattedDate(date) {
        const month = date.getMonth() + 1; // Months are 0-based in JavaScript, so add 1
        const day = date.getDate();
        return `${month}/${day}`;
    }

    // Function to set the title
    function setTitle(formattedDate) {
        const titleElement = document.getElementById('title');
        titleElement.textContent = `Genre of the Day (${formattedDate})`;
    }
});