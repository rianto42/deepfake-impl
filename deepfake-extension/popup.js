const API_URL = 'http://localhost:10000'; // Change this to your API URL
const dropZone = document.getElementById('dropZone');
const previewImage = document.getElementById('previewImage');
const resultDiv = document.getElementById('result');
const loadingDiv = document.getElementById('loading');

// Handle paste event on the entire document
document.addEventListener('paste', async (e) => {
  e.preventDefault(); // Prevent default paste behavior
  const items = e.clipboardData.items;
  
  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      const file = item.getAsFile();
      if (file) {
        await handleImage(file);
        break;
      }
    }
  }
});

// Handle click event
dropZone.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      await handleImage(file);
    }
  };
  input.click();
});

// Handle drag and drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    await handleImage(file);
  }
});

async function handleImage(file) {
  try {
    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImage.src = e.target.result;
      previewImage.style.display = 'block';
    };
    reader.readAsDataURL(file);

    // Show loading
    loadingDiv.style.display = 'block';
    resultDiv.style.display = 'none';

    // Create form data
    const formData = new FormData();
    formData.append('file', file);

    // Send to API
    try {
      const response = await fetch(`${API_URL}/predict`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      
      // Display result
      resultDiv.textContent = `Prediction: ${data.prediction.toUpperCase()} (${(data.probabilities[data.prediction] * 100).toFixed(2)}% confidence)`;
      resultDiv.className = `result ${data.prediction}`;
      resultDiv.style.display = 'block';
    } catch (fetchError) {
      console.error('Fetch error:', fetchError);
      throw new Error(`Failed to connect to API at ${API_URL}. Make sure the server is running.`);
    }
  } catch (error) {
    console.error('Error:', error);
    resultDiv.textContent = `Error: ${error.message}`;
    resultDiv.className = 'result';
    resultDiv.style.display = 'block';
  } finally {
    loadingDiv.style.display = 'none';
  }
} 