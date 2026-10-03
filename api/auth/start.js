// /api/auth/start — redirects the browser into Google's OAuth consent flow.
// Reads GOOGLE_CLIENT_ID from env. No secrets touch the client.

module.exports = async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(500).send('GOOGLE_CLIENT_ID is not set in this deployment.');
  }

  // Fixed production origin — must exactly match callback.js and the
  // redirect URI registered in Google Cloud Console.
  const redirectUri = 'https://task-dash-umber.vercel.app/api/auth/callback';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    login_hint: 'willfarparan@gmail.com',
    scope: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/gmail.readonly',
    ].join(' '),
  });

  res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  res.end();
};
