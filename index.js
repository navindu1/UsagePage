// Import required modules (dependencies)
const express = require('express');
const axios = require('axios');
require('dotenv').config(); // To load variables from the .env file

// Set up the Express app and port
const app = express();
const port = 3000;

// Get panel details from the .env file
const PANEL_URL = process.env.PANEL_URL;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Create Panel API URLs
const LOGIN_URL = `${PANEL_URL}/login`;
const CLIENT_TRAFFIC_URL = `${PANEL_URL}/panel/api/inbounds/getClientTraffics/`;

// A variable to store the session cookie after login
let cookies = '';

/**
 * Function to log in to the V2Ray Panel and get the session cookie.
 */
async function loginToPanel() {
    try {
        console.log('Attempting to log in to the panel...');
        const response = await axios.post(LOGIN_URL, {
            username: ADMIN_USERNAME,
            password: ADMIN_PASSWORD
        }, {
            withCredentials: true,
            maxRedirects: 0,
            validateStatus: status => status >= 200 && status < 400
        });

        // If login is successful, get the 'set-cookie' from the response header
        if (response.headers['set-cookie']) {
            cookies = response.headers['set-cookie'][0];
            console.log('✅ Successfully logged into the panel. Cookie received.');
            return true;
        } else {
            console.error('❌ No cookie received after login.');
            return false;
        }
    } catch (error) {
        console.error('Error during login:', error.message);
        return false;
    }
}

/**
 * Main API endpoint to provide a client's data.
 * Example: /api/check-usage/navindu
 */
app.get('/api/check-usage/:username', async (req, res) => {
    const username = req.params.username;

    // If there is no cookie (initial server start or cookie expiration), log in again
    if (!cookies) {
        console.log('No cookie found. Attempting to log in again...');
        const loggedIn = await loginToPanel();
        if (!loggedIn) {
            return res.status(500).json({ success: false, message: 'Authentication failed. Could not log in to the panel.' });
        }
    }

    try {
        console.log(`Searching for client: ${username}`);
        const trafficUrl = `${CLIENT_TRAFFIC_URL}${username}`;
        
        // Send a GET request to the Panel API to get client data
        const trafficResponse = await axios.get(trafficUrl, {
            headers: { 'Cookie': cookies }
        });

        // If data is received successfully...
        if (trafficResponse.data && trafficResponse.data.success && trafficResponse.data.obj) {
            // Send data as JSON to the frontend
            res.json({ success: true, data: trafficResponse.data.obj });
        } else {
            // Even if a successful response is received from the API, if the client's name cannot be found
            res.status(404).json({ success: false, message: 'Client could not be found.' });
        }
    } catch (error) {
        // If an error occurs in the above try block...
        // This is often because the cookie has expired (Unauthorized error)
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            console.log('Authentication error (Cookie has expired). Attempting to log in again...');
            const loggedIn = await loginToPanel();
            if (loggedIn) {
                 // Since the session has been renewed, notify the frontend to try again
                return res.status(503).json({ success: false, message: 'Session was renewed. Please try your request again.' });
            }
        }
        
        // If there is another error, show it in the console and send an error message to the frontend
        console.error('Error getting client data:', error.message);
        res.status(500).json({ success: false, message: 'An error occurred while retrieving data.' });
    }
});

// Serve static files (like index.html) from the 'public' folder
app.use(express.static('public'));

// Start the server on the specified port
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
    // Attempt to log in to the panel as soon as the server starts
    loginToPanel();
});
