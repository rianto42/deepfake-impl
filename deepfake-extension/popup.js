const API_URL = 'http://localhost:10000'; // Change this to your API URL
const dropZone = document.getElementById('dropZone');
const previewImage = document.getElementById('previewImage');
const resultDiv = document.getElementById('result');
const loadingDiv = document.getElementById('loading');
const scanAllBtn = document.getElementById('scanAllBtn');

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

// Handle scan all images button click
scanAllBtn.addEventListener('click', async () => {
  try {
    scanAllBtn.disabled = true;
    loadingDiv.style.display = 'block';
    resultDiv.style.display = 'none';
    
    // Query the active tab to get all images
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Execute script to get all image URLs from the page
    const scriptResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: () => {
        const images = Array.from(document.images);
        console.log('Found images:', images.length);
        return images.map(img => ({
          src: img.src,
          id: img.id || `deepfake-img-${Math.random().toString(36).substr(2, 9)}`,
          alt: img.alt || '',
          width: img.width,
          height: img.height
        }))
        .filter(img => img.src.startsWith('http') && img.width > 50 && img.height > 50); // Only process images larger than 50x50
      }
    });

    const imageData = scriptResults[0].result;
    console.log('Filtered images:', imageData.length);
    if (imageData.length === 0) {
      resultDiv.textContent = 'No images found on the page.';
      resultDiv.className = 'result';
      resultDiv.style.display = 'block';
      return;
    }

    // Process each image
    const analysisResults = [];
    for (const img of imageData) {
      try {
        console.log('Starting to process image:', img.src);
        
        // Use background script to fetch image
        const imageResponse = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { type: 'fetchImage', url: img.src },
            response => {
              if (response.success) {
                console.log('Successfully fetched image:', img.src);
                resolve(response.data);
              } else {
                console.error('Failed to fetch image:', img.src, response.error);
                reject(new Error(response.error));
              }
            }
          );
        });

        // Convert base64 to blob
        const base64Response = await fetch(imageResponse);
        const blob = await base64Response.blob();
        console.log('Converted image to blob:', img.src);
        
        const formData = new FormData();
        formData.append('file', blob, 'image.jpg');

        console.log('Sending to API:', img.src);
        const apiResponse = await fetch(`${API_URL}/predict`, {
          method: 'POST',
          body: formData
        });

        if (!apiResponse.ok) {
          const errorText = await apiResponse.text();
          console.error('API error:', errorText);
          throw new Error(`Failed to analyze image: ${img.src} - ${errorText}`);
        }

        const data = await apiResponse.json();
        console.log('Received API response:', data);
        
        const result = {
          ...img,
          prediction: data.prediction,
          confidence: data.probabilities[data.prediction] * 100
        };
        analysisResults.push(result);

        // Update overlay immediately after getting prediction
        console.log('Attempting to update overlay for:', img.src);
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: (result) => {
            console.log('Inside executeScript for:', result.src);
            // Try multiple ways to find the image
            let img = null;
            
            // First try exact src match
            const images = Array.from(document.images);
            console.log('Total images on page:', images.length);
            img = images.find(i => i.src === result.src);
            
            // If not found, try finding by dimensions and position
            if (!img && result.width && result.height) {
              console.log('Trying to find image by dimensions:', result.width, result.height);
              img = images.find(i => 
                Math.abs(i.width - result.width) < 5 && 
                Math.abs(i.height - result.height) < 5
              );
            }

            if (img) {
              console.log('Found image to update:', result.src);
              try {
                // Create or update overlay
                let overlay = document.getElementById(`overlay-${result.id}`);
                if (!overlay) {
                  console.log('Creating new overlay for:', result.src);
                  overlay = document.createElement('div');
                  overlay.id = `overlay-${result.id}`;
                  overlay.style.position = 'absolute';
                  overlay.style.top = '0';
                  overlay.style.left = '0';
                  overlay.style.padding = '5px';
                  overlay.style.color = 'white';
                  overlay.style.fontWeight = 'bold';
                  overlay.style.fontSize = '12px';
                  overlay.style.textShadow = '1px 1px 2px black';
                  overlay.style.zIndex = '1000';
                  overlay.style.pointerEvents = 'none';
                  overlay.style.width = '100%';
                  overlay.style.textAlign = 'center';
                  
                  // Make sure the image container has position relative
                  let container = img.parentElement;
                  if (!container || container === document.body) {
                    console.log('Creating container for image in body');
                    container = document.createElement('div');
                    container.style.position = 'relative';
                    container.style.display = 'inline-block';
                    img.parentNode.insertBefore(container, img);
                    container.appendChild(img);
                  } else if (container.style.position !== 'relative') {
                    console.log('Setting container position to relative');
                    container.style.position = 'relative';
                  }
                  
                  container.appendChild(overlay);
                }
                
                // Update overlay content and style
                console.log('Updating overlay content:', result.prediction, result.confidence);
                if(result.prediction == 'fake'){
                  overlay.textContent = `Potential Deepfake (${result.confidence.toFixed(1)}% probability)`;
                  overlay.style.backgroundColor = 'rgba(220, 53, 69, 0.8)';
                } else if(result.prediction == "real"){
                  overlay.textContent = `Real Image (${result.confidence.toFixed(1)}% probability)`;
                  overlay.style.backgroundColor =  'rgba(40, 167, 69, 0.8)';
                }

                // Ensure overlay is visible
                overlay.style.display = 'block';
                overlay.style.opacity = '1';
                console.log('Overlay update complete for:', result.src);
              } catch (error) {
                console.error('Error creating/updating overlay:', error);
              }
            } else {
              console.log('Could not find image to update:', result.src);
            }
          },
          args: [result]
        });
      } catch (error) {
        console.error(`Error processing image ${img.src}:`, error);
      }
    }

    // Display completion message in popup
    resultDiv.textContent = `Finished analyzing ${analysisResults.length} images`;
    resultDiv.className = 'result';
    resultDiv.style.display = 'block';
  } catch (error) {
    console.error('Error:', error);
    resultDiv.textContent = `Error: ${error.message}`;
    resultDiv.className = 'result';
    resultDiv.style.display = 'block';
  } finally {
    loadingDiv.style.display = 'none';
    scanAllBtn.disabled = false;
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
      resultDiv.textContent = `Prediction: ${data.prediction.toUpperCase()} (${(data.probabilities[data.prediction] * 100).toFixed(2)}% probability)`;
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