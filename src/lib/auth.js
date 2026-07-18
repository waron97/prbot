import fetch from 'node-fetch';

async function getToken() {
    const url = process.env.KC_URL;
    const payload = new URLSearchParams();

    payload.append('username', process.env.KC_USER);
    payload.append('password', process.env.KC_PASSWORD);
    payload.append('client_id', process.env.KC_ID);
    payload.append('client_secret', process.env.KC_SECRET);
    payload.append('grant_type', 'password');

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: payload.toString(),
    });

    if (!response.ok) {
        // Never log the response body: on a password-grant endpoint it can
        // echo back the submitted credentials.
        throw new Error(
            `AUTH_FAILED: Keycloak token request failed with status ${response.status}`
        );
    }

    let json;
    try {
        json = await response.json();
    } catch {
        throw new Error('AUTH_FAILED: Keycloak response was not valid JSON');
    }

    if (!json || typeof json.access_token !== 'string' || !json.access_token) {
        throw new Error('AUTH_FAILED: Keycloak response did not contain an access_token');
    }

    return json.access_token;
}

export { getToken };
