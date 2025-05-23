document.getElementById('scanButton').addEventListener('click', async () => {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = 'Scanning page for images...';
  statusDiv.className = 'status scanning';

  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Execute content script to scan images
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: scanImages
    });
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'status error';
  }
});

// Function that will be injected into the page
function scanImages() {
  const images = document.getElementsByTagName('img');
  const API_URL = 'http://localhost:10000/predict';

  Array.from(images).forEach(async (img) => {
    try {
      // Skip if image is too small or already processed
      if (img.width < 100 || img.height < 100 || img.dataset.deepfakeChecked) return;

      // Create a canvas to get the image data
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      // Convert canvas to blob
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
      
      // Create form data
      const formData = new FormData();
      formData.append('file', blob, 'image.jpg');

      // Send to API
      const response = await fetch(API_URL, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      
      // Mark image as processed
      img.dataset.deepfakeChecked = 'true';

      // Add overlay based on result
      const overlay = document.createElement('div');
      overlay.style.position = 'absolute';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.padding = '5px';
      overlay.style.color = 'white';
      overlay.style.fontWeight = 'bold';
      overlay.style.fontSize = '12px';
      overlay.style.textShadow = '1px 1px 1px black';
      
      if (result.prediction === 'fake') {
        overlay.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
        overlay.textContent = `Potential Deepfake (${Math.round(result.probabilities.fake * 100)}% probability)`;
      } else {
        overlay.style.backgroundColor = 'rgba(0, 255, 0, 0.7)';
        overlay.textContent = `Real Image (${Math.round(result.probabilities.real * 100)}% probability)`;
      }

      // Make image container relative if it's not already
      const container = img.parentElement;
      if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }

      // Add overlay to container
      container.appendChild(overlay);
    } catch (error) {
      console.error('Error processing image:', error);
    }
  });
} 