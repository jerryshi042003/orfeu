document.addEventListener('DOMContentLoaded', function() {
    const genreElement = document.getElementById('genre');
    const spotifyLinkElement = document.getElementById('spotify-link');
    const spotifyLinkTextElement = document.getElementById('spotify-link-text');
    const descriptionElement = document.getElementById('description'); // Element for description
    const wordPyramidElement = document.getElementById('word-pyramid'); // Element for D3 visualization

    // Fetch the CSV file
    fetch('genres.csv')
        .then(response => response.text())
        .then(text => {
            // Parse CSV data
            const lines = text.split('\n');
            const genres = lines.slice(1).filter(line => line.trim() !== ''); // Skip header and empty lines

            // Get the current date
            const today = new Date();
            const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);

            // Select genre based on the day of the year
            const genreIndex = dayOfYear % genres.length;
            const genreOfDay = genres[genreIndex].trim(); // Trim whitespace and carriage returns

            // Display the genre
            genreElement.textContent = genreOfDay;

            // Create the Spotify search link
            const spotifySearchUrl = `https://open.spotify.com/search/${encodeURIComponent(genreOfDay)}/playlists`;
            spotifyLinkElement.href = spotifySearchUrl;
            spotifyLinkTextElement.textContent = spotifySearchUrl;
            spotifyLinkTextElement.href = spotifySearchUrl;

            // Set static text for testing
            descriptionElement.innerText = 'This is a test description to verify if the description area works.';

            // Create a word pyramid using D3
            const descriptionText = descriptionElement.innerText;
            const words = descriptionText.split(/\s+/);
            const wordCounts = words.reduce((acc, word) => {
                word = word.toLowerCase().replace(/[^\w]/g, '');
                if (word) {
                    acc[word] = (acc[word] || 0) + 1;
                }
                return acc;
            }, {});

            const wordArray = Object.entries(wordCounts).map(([word, count]) => ({ word, count }));

            // Set up the SVG canvas dimensions
            const width = wordPyramidElement.clientWidth;
            const height = wordPyramidElement.clientHeight;

            // Clear previous content
            d3.select(wordPyramidElement).selectAll("*").remove();

            const svg = d3.select(wordPyramidElement).append('svg')
                .attr('width', width)
                .attr('height', height);

            const pyramidHeight = 200;
            const maxCount = d3.max(wordArray, d => d.count);

            // Create a scale for word size based on count
            const sizeScale = d3.scaleLinear()
                .domain([0, maxCount])
                .range([10, 50]);

            // Create a scale for vertical positioning
            const yScale = d3.scaleBand()
                .domain(wordArray.map(d => d.word))
                .range([0, pyramidHeight])
                .padding(0.2);

            svg.selectAll('text')
                .data(wordArray)
                .enter().append('text')
                .attr('x', width / 2)
                .attr('y', (d, i) => yScale(d.word) + 20)
                .attr('font-size', d => `${sizeScale(d.count)}px`)
                .attr('text-anchor', 'middle')
                .text(d => d.word);
        })
        .catch(error => {
            console.error('Error fetching the CSV file:', error);
        });
});



// document.addEventListener('DOMContentLoaded', function() {
//     const genreElement = document.getElementById('genre');
//     const spotifyLinkElement = document.getElementById('spotify-link');
//     const spotifyLinkTextElement = document.getElementById('spotify-link-text');
//     const descriptionElement = document.getElementById('description'); // Element for description

//     // Set static text for testing initially
//     descriptionElement.innerText = 'Loading description...'; // Indicate loading state

//     // Function to update description element
//     function updateDescription(text) {
//         descriptionElement.innerText = text;
//     }

//     // Fetch the CSV file
//     fetch('genres.csv')
//         .then(response => {
//             if (!response.ok) {
//                 throw new Error(`HTTP error! Status: ${response.status}`);
//             }
//             return response.text();
//         })
//         .then(text => {
//             // Parse CSV data
//             const lines = text.split('\n');
//             const genres = lines.slice(1).filter(line => line.trim() !== ''); // Skip header and empty lines

//             // Get the current date
//             const today = new Date();
//             const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);

//             // Select genre based on the day of the year
//             const genreIndex = dayOfYear % genres.length;
//             const genreOfDay = genres[genreIndex].trim(); // Trim whitespace and carriage returns

//             // Display the genre
//             genreElement.textContent = genreOfDay;

//             // Create the Spotify search link
//             const spotifySearchUrl = `https://open.spotify.com/search/${encodeURIComponent(genreOfDay)}/playlists`;
//             spotifyLinkElement.href = spotifySearchUrl;
//             spotifyLinkTextElement.textContent = spotifySearchUrl;
//             spotifyLinkTextElement.href = spotifySearchUrl;

//             // Fetch Wikipedia description
//             fetchWikipediaDescription(genreOfDay);

//         })
//         .catch(error => {
//             console.error('Error fetching the CSV file:', error);
//             // Update description to indicate error
//             updateDescription('Failed to load description 1.');
//         });

//     // Function to fetch Wikipedia description
//     function fetchWikipediaDescription(searchTerm) {
//         fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(searchTerm)}`)
//             .then(response => {
//                 if (!response.ok) {
//                     throw new Error(`HTTP error! Status: ${response.status}`);
//                 }
//                 return response.json();
//             })
//             .then(data => {
//                 if (data.extract) {
//                     updateDescription(data.extract);
//                 } else {
//                     updateDescription('No description found.');
//                 }
//             })
//             .catch(error => {
//                 console.error('Error fetching Wikipedia content:', error);
//                 updateDescription('Failed to load description 2.');
//             });
//     }
// });
