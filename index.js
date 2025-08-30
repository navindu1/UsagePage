// =======================================================================
// NexGuard AI - V2Ray Usage Matrix Backend
// Version: 2.0 (Case-Insensitive Username Support)
// =======================================================================

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

// --- Panel API URLs ---
// V2Ray Panel එකට login වීමට
const LOGIN_URL = `${PANEL_URL}/login`;
// Client කෙනෙකුගේ data traffic ලබාගැනීමට
const CLIENT_TRAFFIC_URL = `${PANEL_URL}/panel/api/inbounds/getClientTraffics/`;
// සියලුම Inbounds (සහ ඒ තුළ ඇති clients) ලැයිස්තුව ලබාගැනීමට
const INBOUNDS_LIST_URL = `${PANEL_URL}/panel/api/inbounds/list`;

// Session cookie එක login වූ පසු ගබඩා කර තබාගැනීමට
let cookies = '';

/**
 * V2Ray Panel එකට login වී session cookie එක ලබාගැනීමේ function එක
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
 * Client කෙනෙකුගේ data ලබාදෙන ප්‍රධාන API endpoint එක.
 * මෙම සංස්කරණය Capital/Simple (case-insensitive) ඕනෑම username එකක් සඳහා ක්‍රියා කරයි.
 */
app.get('/api/check-usage/:username', async (req, res) => {
    // Frontend එකෙන් user type කරපු username එක (උදා: 'navindu' or 'Navindu')
    const userInputUsername = req.params.username;

    // Cookie එක නැත්නම් (server එක පටන් ගත්තාම හෝ expire වූ විට) නැවත login වෙනවා
    if (!cookies) {
        console.log('No cookie found. Attempting to log in again...');
        const loggedIn = await loginToPanel();
        if (!loggedIn) {
            return res.status(500).json({ success: false, message: 'Authentication failed. Could not log in to the panel.' });
        }
    }

    try {
        // පියවර 1: Panel එකේ සියලුම clients ලා ඉන්න list එක ගෙන්වා ගැනීම
        console.log('Fetching all clients from the panel...');
        const inboundsResponse = await axios.get(INBOUNDS_LIST_URL, {
            headers: { 'Cookie': cookies }
        });
        
        let foundClient = null;

        // පියවර 2: ගත්ත list එකේ user ට ගැලපෙන කෙනෙක් ඉන්නවද කියා Case-Insensitiveව සෙවීම
        if (inboundsResponse.data && inboundsResponse.data.success) {
            const allInbounds = inboundsResponse.data.obj;
            for (const inbound of allInbounds) {
                // සමහර panel වල clientStats වලින්ද, සමහර ඒවායේ settings.clients වලින්ද client list එක එන්නේ
                const clients = inbound.clientStats || (inbound.settings && JSON.parse(inbound.settings).clients);
                
                if (clients && clients.length > 0) {
                    // user ගේ input එක simple කරලා, panel එකේ username එකත් simple කරලා સરખાવමු
                    // ගැලපෙන කෙනා හම්බවුනොත්, එයාගේ සම්පූර්ණ object එකම `client` විචල්‍යයට ගන්නවා
                    const client = clients.find(c => c.email.toLowerCase() === userInputUsername.toLowerCase());
                    if (client) {
                        foundClient = client;
                        break; // හම්බවුන ගමන් loop එක නවත්වනවා
                    }
                }
            }
        }
        
        // පියවර 3: ගැලපෙන Client කෙනෙක් හම්බවුනා නම්...
        if (foundClient) {
            // Panel එකේ තියෙන නියම username එක (උදා: 'Navindu')
            const correctUsername = foundClient.email;
            console.log(`Client found. Correct username is "${correctUsername}". Fetching traffic data...`);

            // පියවර 4: ඒ නියම username එක භාවිතා කර traffic data එක ගෙන්වා ගැනීම
            const trafficUrl = `${CLIENT_TRAFFIC_URL}${correctUsername}`;
            const trafficResponse = await axios.get(trafficUrl, {
                headers: { 'Cookie': cookies }
            });

            if (trafficResponse.data && trafficResponse.data.success) {
                res.json({ success: true, data: trafficResponse.data.obj });
            } else {
                res.status(404).json({ success: false, message: 'Client found, but could not retrieve traffic data.' });
            }
        } else {
            // පියවර 5: Client කෙනෙක් හම්බවුනේ නැත්නම් 404 error එක යැවීම
            console.log(`Client "${userInputUsername}" could not be found.`);
            res.status(404).json({ success: false, message: 'Client could not be found.' });
        }

    } catch (error) {
        // Cookie expire වෙලා නම් (401 හෝ 403 error)
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            console.log('Authentication error (Cookie has expired). Attempting to log in again...');
            const loggedIn = await loginToPanel();
            if (loggedIn) {
                 // Session එක renew කරපු නිසා, ආයෙත් try කරන්න කියලා frontend එකට දන්වනවා
                return res.status(503).json({ success: false, message: 'Session was renewed. Please try your request again.' });
            }
        }
        
        // වෙනත් error එකක් නම්
        console.error('Error getting client data:', error.message);
        res.status(500).json({ success: false, message: 'An error occurred while retrieving data.' });
    }
});

// 'public' folder එකේ ඇති static files (index.html වැනි) serve කිරීම
app.use(express.static('public'));

// නියමිත port එකෙන් server එක ආරම්භ කිරීම
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
    // Server එක පටන් ගත්ත ගමන් Panel එකට login වීමට උත්සාහ කිරීම
    loginToPanel();
});