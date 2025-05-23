from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from clearml import Model
import torch
import torch.nn.functional as F
from torchvision import transforms
from torchvision.models import inception_v3, Inception_V3_Weights
import torch.nn as nn
from PIL import Image
import io
import httpx
from fastapi.responses import Response
from urllib.parse import unquote

device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
MODEL_ID = "8321dde2ac2e4556b015913cb634be9c"#"45d532d8716f43c28a136cd8b3f4503d"

def create_model():
    output_class = 2
    model = inception_v3(weights=Inception_V3_Weights.DEFAULT)
    for p in model.parameters():
        p.requires_grad = False
    num_features = model.fc.in_features
    model.fc = nn.Linear(num_features, output_class)
    return model


def load_model():
    """Download & load the PyTorch model artifact from ClearML."""
    try:
        clearml_model = Model(model_id=MODEL_ID)
        local_path = clearml_model.get_local_copy()
        model = create_model()  # same as in training
        state = torch.load(local_path, map_location=device)
        model.load_state_dict(state)
        model.to(device).eval()
        return model
    except Exception as e:
        raise RuntimeError(f"Failed to load model: {str(e)}")

# same preprocessing you used during training:
preprocess = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    ),
])

app = FastAPI(title="Deepfake API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to specific origin in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load Model
try:
    model = load_model()
except Exception as e:
    print(f"Warning: Failed to load model during startup: {str(e)}")
    model = None

@app.post("/predict")
async def predict_image(
    file: UploadFile = File(...),
    threshold: float = Query(0.75, description="Probability threshold for real prediction (0-1)")
):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
        
    if not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    if not 0 <= threshold <= 1:
        raise HTTPException(status_code=400, detail="Threshold must be between 0 and 1")
        
    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        input_tensor = preprocess(image).unsqueeze(0)  # Add batch dimension

        with torch.no_grad():
            output = model(input_tensor)
            probabilities = F.softmax(output, dim=1)[0]  # Apply softmax to get probabilities
            real_prob = float(probabilities[0])
            fake_prob = float(probabilities[1])
            print(f"Real probability: {real_prob}, Fake probability: {fake_prob}")
            
            # Use threshold to determine prediction
            result = "real" if real_prob >= threshold else "fake"

        return {
            "prediction": result,
            "probabilities": {
                "real": real_prob,
                "fake": fake_prob
            },
            "threshold": threshold
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/proxy-image")
async def proxy_image(url: str):
    """Proxy endpoint to fetch images with CORS headers."""
    try:
        # Decode the URL
        decoded_url = unquote(url)
        
        async with httpx.AsyncClient() as client:
            response = await client.get(decoded_url)
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Failed to fetch image")
            
            return Response(
                content=response.content,
                media_type=response.headers.get("content-type", "image/jpeg"),
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET",
                    "Access-Control-Allow-Headers": "*",
                }
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))