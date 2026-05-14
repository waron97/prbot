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

    const json = await response.json();
    return json.access_token;
}

export { getToken };
