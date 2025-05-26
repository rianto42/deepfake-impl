// Function to get image through our proxy
async function getImageThroughProxy(imgUrl) {
  try {
    // Use our FastAPI proxy endpoint
    const proxyUrl = `http://localhost:10000/proxy-image?url=${encodeURIComponent(imgUrl)}`;
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      throw new Error(`Proxy request failed: ${response.status}`);
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error('Error fetching image through proxy:', error);
    return null;
  }
}

// Function to check if an image is accessible
async function isImageAccessible(img) {
  return new Promise((resolve) => {
    if (img.complete) {
      resolve(true);
    } else {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      // Set a timeout in case the image never loads
      setTimeout(() => resolve(false), 5000);
    }
  });
}

// Function to scan a single image
async function scanImage(img) {
  try {
    // Skip if already processed
    if (img.dataset.deepfakeChecked) return;

    // Wait for image to be fully loaded
    const isAccessible = await isImageAccessible(img);
    if (!isAccessible) {
      console.log('Image not accessible:', img.src);
      return;
    }

    // Skip if image is too small (but log it)
    if (img.width < 50 || img.height < 50) {
      console.log('Image too small:', img.src, `${img.width}x${img.height}`);
      return;
    }

    // Try to get the image through proxy
    const proxyImageUrl = await getImageThroughProxy(img.src);
    if (!proxyImageUrl) {
      console.log('Failed to get image through proxy:', img.src);
      return;
    }

    // Create a new image element with the proxy URL
    const proxyImg = new Image();
    proxyImg.crossOrigin = 'anonymous';
    proxyImg.src = proxyImageUrl;

    // Wait for the proxy image to load
    await new Promise((resolve, reject) => {
      proxyImg.onload = resolve;
      proxyImg.onerror = reject;
      setTimeout(reject, 5000);
    });

    // Create a canvas to get the image data
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Set canvas size to match image
    canvas.width = proxyImg.naturalWidth;
    canvas.height = proxyImg.naturalHeight;
    
    try {
      ctx.drawImage(proxyImg, 0, 0);
    } catch (e) {
      console.log('Failed to draw image to canvas:', img.src, e);
      return;
    }

    // Convert canvas to blob
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    if (!blob) {
      console.log('Failed to create blob from image:', img.src);
      return;
    }
    
    // Create form data
    const formData = new FormData();
    formData.append('file', blob, 'image.jpg');

    // Send to API
    const response = await fetch('http://localhost:10000/predict', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

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
    overlay.style.zIndex = '9999'; // Ensure overlay is visible
    
    if (result.prediction === 'fake') {
      overlay.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
      overlay.textContent = `Potential Deepfake (${Math.round(result.probabilities.fake * 100)}% probability)`;
    } else {
      overlay.style.backgroundColor = 'rgba(0, 255, 0, 0.7)';
      overlay.textContent = `Real Image (${Math.round(result.probabilities.real * 100)}% probability)`;
    }

    // Make image container relative if it's not already
    const container = img.parentElement;
    if (container) {
      if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }
      // Add overlay to container
      container.appendChild(overlay);
    } else {
      // If no container, add overlay directly to image
      img.style.position = 'relative';
      img.parentNode.insertBefore(overlay, img.nextSibling);
    }

    // Clean up the proxy URL
    URL.revokeObjectURL(proxyImageUrl);
  } catch (error) {
    console.error('Error processing image:', img.src, error);
  }
}

// Function to scan all images on the page
async function scanAllImages() {
  const images = document.getElementsByTagName('img');
  console.log(`Found ${images.length} images on the page`);
  
  for (const img of images) {
    await scanImage(img);
  }
}

// Initial scan when page loads
window.addEventListener('load', () => {
  console.log('Page fully loaded, starting initial scan');
  scanAllImages();
});

// Create a MutationObserver to watch for new images
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      // Check if the added node is an image
      if (node.nodeName === 'IMG') {
        scanImage(node);
      }
      // Check if the added node contains images
      if (node.getElementsByTagName) {
        const images = node.getElementsByTagName('img');
        Array.from(images).forEach(img => scanImage(img));
      }
    });
  });
});

// Start observing the document with the configured parameters
observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scanImages') {
    scanAllImages();
    sendResponse({ status: 'scanning' });
  }
}); 