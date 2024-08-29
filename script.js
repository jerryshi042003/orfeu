async function getWikipediaContent(genreName) {
    const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/parse/${genreName}?prop=text`);
    const data = await response.json();
    const htmlContent = data.parse.text['*'];
    return htmlContent;
}

// Function to display content in the HTML
function displayContent(content) {
    document.getElementById('content').innerHTML = content;
}

// Fetch and display Wikipedia content when the page loads
document.addEventListener('DOMContentLoaded', async () => {
    const genreName = 'Jazz';  // You can replace this with any genre you want
    const content = await getWikipediaContent(genreName);
    displayContent(content);
    document.getElementById('genre-name').textContent = genreName;
});
