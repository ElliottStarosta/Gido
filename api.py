from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import os
import re
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

SERVER_API_KEY = os.environ.get('OPENROUTER_API_KEY', '')

@app.route('/health', methods=['GET'])
def health():
    """Health check"""
    return jsonify({'status': 'healthy'})

@app.route('/api/chat', methods=['POST'])
def chat():
    """Single endpoint that acts like OpenRouter API but hides the key"""
    try:
        data = request.json
        
        if not data or 'messages' not in data:
            return jsonify({'error': 'Invalid request'}), 400
        
        if not SERVER_API_KEY:
            return jsonify({'error': 'Server not configured'}), 500
        
        # Forward to OpenRouter with server's API key (never exposed to client)
        response = requests.post(
            'https://openrouter.ai/api/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {SERVER_API_KEY}',
                'HTTP-Referer': request.headers.get('Referer', 'http://localhost'),
                'Content-Type': 'application/json'
            },
            json={
                'model': data.get('model', 'arcee-ai/trinity-mini:free'),
                'messages': data.get('messages', []),
                'temperature': data.get('temperature', 0.2),
                'max_tokens': data.get('max_tokens', 500)
            }
        )
        
        if response.status_code != 200:
            return jsonify({'error': 'API error', 'details': response.text}), response.status_code
        
        # Return the OpenRouter response as-is
        return jsonify(response.json())
    
    except Exception as e:
        print(f"Error: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    if not SERVER_API_KEY:
        print("WARNING: OPENROUTER_API_KEY environment variable not set!")
    
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)