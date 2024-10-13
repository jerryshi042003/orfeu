document.addEventListener('DOMContentLoaded', function() {
    // Get the current date once and reuse it
    const today = new Date();
    const formattedDate = getFormattedDate(today);

    // Set the title when the page loads
    setTitle(formattedDate);

    const locationElement = document.getElementById('location');
    const spotifyLinkElement = document.getElementById('spotify-link');
    const spotifyLinkTextElement = document.getElementById('spotify-link-text');
    const descriptionElement = document.getElementById('description'); // Element for description


    // Function to update description element
    function updateDescription(text) {
        descriptionElement.innerText = text;
    }

    // Fetch the CSV file
    fetch('../assets/data/passed_rows.csv')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            console.log('CSV file fetched successfully');

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
            locationElement.textContent = name;

            // Use the Spotify link from the CSV
            spotifyLinkElement.href = spotifyLink;
            spotifyLinkTextElement.textContent = spotifyLink;
            spotifyLinkTextElement.href = spotifyLink;

        })
        .catch(error => {
            console.error('Error fetching the CSV file:', error);
            // Update description to indicate error
            updateDescription('Failed to load description 1.');
        });

    // Function to get the current date and format it as mm/dd
    function getFormattedDate(date) {
        const month = date.getMonth() + 1; // Months are 0-based in JavaScript, so add 1
        const day = date.getDate();
        return `${month}/${day}`;
    }

    // Function to set the title
    function setTitle(formattedDate) {
        const titleElement = document.getElementById('title');
        titleElement.textContent = `location of the Day (${formattedDate})`;
    }
});
