# GIDO - AI Navigator

An intelligent browser extension that uses AI to help you navigate any website by voice or text commands. GIDO understands your goals and guides you through web navigation by highlighting elements, detecting actions, and adapting to multi-step tasks across different pages.

## Features

- **Voice Commands**: Control navigation using natural speech (with Web Speech API support)
- **Text Instructions**: Type or paste goals for GIDO to execute
- **Smart Element Detection**: Automatically identifies interactive elements (buttons, links, inputs, etc.)
- **Cross-Domain Navigation**: Seamlessly follows your journey across different websites
- **Real-time Highlighting**: Visual feedback showing which elements to interact with
- **Instruction History**: Track all steps taken during a navigation session
- **Magnified Text Display**: Enhanced 2x zoom magnifier for better readability
- **Thinking Indicator**: Visual feedback while AI processes your requests
- **Customizable UI**: Floating panel with beautiful glassmorphism design
- **Journey Completion Detection**: AI recognizes when goals are achieved

## How It Works

1. **Click the GIDO button** in your browser's extension area
2. **Say or type your goal** (e.g., "Find the login page" or "Search for Python tutorials")
3. **GIDO analyzes the page** and identifies the next logical step
4. **Follow the highlighted element** and the instruction tooltip
5. **Interact with the element** (click, type, select)
6. **Repeat** until GIDO detects your goal is complete

## Installation

### Prerequisites
- Modern web browser (Chrome, Edge, Brave, etc.)

### Setup

1. Open your browser's extension management page:
   - Chrome/Edge: `chrome://extensions`
   - Brave: `brave://extensions`
   - Firefox: `about:addons`

2. Enable "Developer mode" (top right)

3. Click "Load unpacked" and select the project directory

4. The GIDO extension should now appear in your extensions list

The backend API is hosted on Render and requires no local setup.

## Project Structure

```
├── content.js              # Main extension content script
├── background.js           # Service worker for background tasks
├── manifest.json           # Extension manifest configuration
├── gsap.min.js            # Animation library (GSAP)
└── README.md              # This file
```

## Architecture

### Frontend (Chrome Extension)
- **content.js**: Runs on every webpage, handles UI injection, element detection, and user interaction
- **background.js**: Service worker that manages extension state and ensures content scripts stay active
- **Manifest.json**: Defines extension permissions and configuration

### Backend (Hosted on Render)
- Flask API server that securely forwards requests to OpenRouter's AI models
- Keeps API keys secure (never exposed to client)
- Handles requests and responses from the extension

## Configuration

The extension is pre-configured to use the hosted API endpoint:

```javascript
apiServerUrl: 'https://gido-zb9c.onrender.com'  // Hosted backend
model: 'kwaipilot/kat-coder-pro:free'           // AI model to use
temperature: 0.2                                 // Creativity level (0-1)
max_tokens: 500                                  // Response length limit
```

No environment variables or local configuration needed.

## Keyboard Shortcuts

- **Alt + Shift + E**: Complete the current journey/goal
- **Alt + Shift + C**: Enable click mode (manually select elements)

## API Integration

GIDO uses OpenRouter to access various AI models. The backend server:

1. Receives navigation requests from the extension
2. Formats the page context with available elements
3. Sends to OpenRouter's API with your credentials
4. Parses AI response to identify next actions
5. Returns instructions to the extension

## How It Detects Goals Are Complete

The AI evaluates:
- Current page URL matching the goal
- Page content indicating task completion
- Navigation context from previous steps
- Element availability and relevance

When it detects completion, it responds with `NONE` and triggers the journey complete notification.

## UI Components

### Main Panel
- **FAB (Floating Action Button)**: Quick access icon
- **Input Field**: Type instructions or view voice transcript
- **Microphone Button**: Toggle voice recognition
- **Instruction History**: View all steps taken
- **Status Box**: Real-time feedback and processing status
- **End Journey Button**: Manually stop navigation

### Visual Feedback
- **Highlight Overlay**: Animated border around target element
- **Tooltip**: Shows action and instruction text
- **Magnifier**: 2x zoom lens when hovering over UI text
- **Typing View**: Large text display while entering commands
- **Thinking Indicator**: Loading state while AI processes

## Troubleshooting

### Extension not loading
- Verify `manifest.json` is valid JSON
- Check browser console for errors (F12 → Console)
- Ensure all required files are in the project directory

### AI not responding
- Verify the Render backend is online (check at `https://gido-zb9c.onrender.com/health`)
- Check browser console for network errors (F12 → Console → Network)
- Verify you have an active internet connection

### Voice recognition not working
- Check browser supports Web Speech API
- Grant microphone permissions when prompted
- Ensure language is set to "en-US"

### Elements not highlighting
- Check element visibility (not hidden or display: none)
- Verify element is interactive (button, link, input, etc.)
- Clear browser cache and reload extension

## Performance Tips

- Keep instruction history manageable (max 10 items stored)
- Use specific, clear goals for better AI accuracy
- Close unnecessary tabs to improve response time
- Update extension regularly for bug fixes

## Privacy & Security

- API keys are stored server-side only
- Extension doesn't collect personal data
- All communication uses HTTPS (when deployed)
- Page content is sent to AI only for navigation analysis
- History is stored locally in browser

## Contributing

To improve GIDO:

1. Test across different websites
2. Report bugs with reproduction steps
3. Suggest UI/UX improvements
4. Contribute better AI prompts
5. Optimize performance bottlenecks

## Dependencies

### Frontend
- **GSAP 3.12.2**: Smooth animations and UI transitions
- **Web Speech API**: Voice recognition (browser built-in)

### Backend
- **Flask 2.3.3**: Web framework
- **Flask-CORS 4.0.0**: Cross-origin requests
- **Requests 2.31.0**: HTTP library for API calls
- **Python-dotenv 1.0.0**: Environment variable management
- **Gunicorn 21.2.0**: Production WSGI server

## License

[Add your license here]

## Support

For issues and questions:
- Check the troubleshooting section above
- Review browser console for error messages
- Verify backend server is running and accessible
- Check extension permissions in browser settings

## Future Enhancements

- [ ] Support for more AI models and providers
- [ ] Offline mode with local AI
- [ ] Custom workflow recording and playback
- [ ] Team collaboration features
- [ ] Analytics and usage insights
- [ ] Mobile browser support
- [ ] Multi-language support
- [ ] Advanced element filtering and targeting

---

**Version**: 2.0  
**Last Updated**: 2025  
**Status**: Active Development